const express = require("express");
const axios = require("axios");
const { getRouter } = require("stremio-addon-sdk");

//Dùng đọc file html
const fs = require("fs");
const path = require("path");

const addonInterface = require("./addon");
const { getTorBoxLink } = require("./torbox");

const app = express();
const PORT = process.env.PORT || 7000;

// 🌟 THÊM MỚI: Khởi tạo bảng băm lưu trữ bộ nhớ đệm IP map Token trong RAM Server
// Cấu trúc dạng: { "113.161.x.x": "MÃ_TOKEN_BASE64" }
const DEVICES_SESSION_STORE = {};

// ======================================================================
// 1. CẤU HÌNH CƠ SỞ (MIDDLEWARE & CORS)
// ======================================================================
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    next();
});

// 🌟 THÊM ĐOẠN NÀY: Mở endpoint cấp tệp tĩnh style.css ra internet công khai
app.get("/style.css", (req, res) => {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.sendFile(path.join(process.cwd(), "style.css"));
});
// Mở endpoint cấp tệp tĩnh script.js ra internet công khai
app.get("/script.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.sendFile(path.join(process.cwd(), "script.js"));
});

// Mở endpoint cấp tệp tĩnh qrcode.js ra internet công khai
app.get("/qrcode.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.sendFile(path.join(process.cwd(), "qrcode.js"));
});

// ======================================================================
// 1. GIAO DIỆN CẤU HÌNH - ĐỌC TỪ FILE CONFIGURE.HTML RIÊNG BIỆT
// ======================================================================
// ======================================================================
// ENDPOINT PHÂN PHỐI TRANG CONFIG VIP (TỐI ƯU BẰNG RES.SENDFILE)
// ======================================================================
app.get(["/", "/configure"], (req, res) => {
    console.log("[SERVER] Đang tối ưu phân phối file configure.html trực tiếp ra internet...");
    
    // 🌟 SỬA ĐỔI MẤU CHỐT: Sử dụng hàm chính quy của Express
    // Tự động đọc file và stream trực tiếp nhị phân, tự bọc Content-Type UTF-8 sạch sẽ
    return res.sendFile(path.join(process.cwd(), "configure.html"), (err) => {
        if (err) {
            console.error("[SERVER ERROR] Lỗi phân phối file trang cấu hình:", err.message);
            return res.status(500).send("Không thể tải trang cấu hình hệ thống.");
        }
    });
});

// ======================================================================
// 3. ENDPOINT XUẤT MANIFEST GỐC (/MANIFEST.JSON)
// ======================================================================
// app.get("/manifest.json", (req, res) => {
//     console.log("[SERVER] Xuất file manifest.json thô phục vụ kiểm tra hệ thống...");
//     res.setHeader("Content-Type", "application/json; charset=utf-8");
//     return res.json(addonInterface.manifest);
// });

// server.js - Tầng bẫy JSON Manifest tối tân bẻ khóa giao diện 3 ô Dropdown
app.get(["/manifest.json", "/:config/manifest.json"], (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const YEAR_OPTIONS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020"];
    let STUDIO_OPTIONS = [];//["Missax", "Teamskeet", "WowGirls", "SweetHeart", "FC2", "Uncen"];

    const configParam = req.params.config || req.url;
    const decodedParam = decodeURIComponent(configParam);
   

    // Gắp IP thật của thiết bị để phục vụ bẫy khóa lưu session
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "local";
    const cleanIp = clientIp.split(',')[0].trim();

    let showAdultVal = "false";
    let torboxTokenVal = "none";
    //let finalUserOptions = [];
    let UserOptions = [];
    if (decodedParam.includes("torbox_token=")) {
        const URLParts = decodedParam.split("|");
        URLParts.forEach(part => {
            const [key, value] = part.split("=");
            if (key && value) {
                const cleanValue = value.split("/")[0].trim();
                if (key.includes("show_adult")) showAdultVal = cleanValue.toLowerCase();
                if (key.includes("torbox_token")) torboxTokenVal = cleanValue;


                if (key.includes("user_genres")) {
                    console.log(`user_genres: ${cleanValue}`);
                    UserOptions = cleanValue.split(",");
                    //STUDIO_OPTIONS = UserOptions;
                    UserOptions.forEach(name => {
                        STUDIO_OPTIONS.push(name);  
                    });
                }
            }
        });
        
        // 🌟 GHIN NHỚ VÀO RAM: Lưu vĩnh viễn cấu hình của thiết bị IP này khi nạp Addon lần đầu
        if (cleanIp && torboxTokenVal !== "none") {
            DEVICES_SESSION_STORE[cleanIp] = { token: torboxTokenVal, showAdult: showAdultVal};
            console.log(`[SESSION SAVED] IP [${cleanIp}] -> Đã ghim Token: ${torboxTokenVal.substring(0,6)}... | Adult: ${showAdultVal}`);
        }
    }

    // 🌟 BẺ KHÓA TRỰC TIẾP TẦNG CỔNG INTERNET (BYPASS SDK CHỐNG SẬP NGUỒN):
    // Ép nhồi chữ "addon_catalog" ra ngoài cổng mạng thô để Stremio Client đọc hiểu
    let dynamicManifest = JSON.parse(JSON.stringify(addonInterface.manifest));
    dynamicManifest.resources = ["catalog", "meta", "stream", "addon_catalog"];
    dynamicManifest.types = ["movie", "series"];

    // Định nghĩa danh sách hiển thị ở ô dropdown số 1 bên trái cùng (Đồng bộ ID "community")
    dynamicManifest.addonCatalogs = [
        { type: "movie", id: "tpb_movie_vip", name: "🎥 Kho Phim Lẻ VIP" },
        { type: "series", id: "tpb_series_vip", name: "📺 Kho Phim Bộ VIP" }
    ];

    // Cấu hình các hàng phim xuất hiện ở ô số 2
    const baseCatalogs = [
        { id: "tpb_all", name: "[TPB] All" },
        { id: "tpb_action", name: "[TPB] Action" },
        { id: "tpb_comedy", name: "[TPB] Comedy" },
        { id: "tpb_horror", name: "[TPB] Horror" },
        { id: "tpb_scifi", name: "[TPB] Sci-Fi" }
    ];

    if (decodedParam.includes("show_adult=true")) {
        baseCatalogs.push({ id: "tpb_adult", name: "🔞 Adult 18+" });
    }

    // Ép cấu trúc ô số 3 chứa mảng năm phát hành
    dynamicManifest.catalogs = baseCatalogs.map(cat => {
        return {
            type: cat.id === "tpb_all" || cat.id === "tpb_action" || cat.id === "tpb_comedy" || cat.id === "tpb_horror" || cat.id === "tpb_scifi" || cat.id === "tpb_adult" ? "movie" : "series",
            id: cat.id,
            name: cat.name,
            genres: cat.id === "tpb_adult" ? [...STUDIO_OPTIONS, ...YEAR_OPTIONS] : YEAR_OPTIONS,
            extraSupported: ["search", "genre", "skip"],
            extra: [
                {   name: "genre", 
                    options: cat.id === "tpb_adult" ? [...STUDIO_OPTIONS, ...YEAR_OPTIONS] : YEAR_OPTIONS,
                    isRequired: false 
                },
                { name: "search" },
                { name: "skip" }
            ],
            extraRequired: []
        };
    });

    return res.json(dynamicManifest);
});


// ======================================================================
// 4. TRẠM TRUNG CHUYỂN VIDEO PROXY - FIX LỖI PLAYBACK ERROR
// ======================================================================
app.get("/play/torbox/:hash/:token", async (req, res) => {
    const { hash, token } = req.params;
    
    // ĐỌC THAM SỐ MAGNET: Lấy chuỗi magnet đã mã hóa từ Query String (?magnet=...)
    const magnetLink = req.query.magnet ? decodeURIComponent(req.query.magnet) : null;
    
    console.log(`\n[PLAY REQUEST] Người dùng bấm xem phim! Đang bẻ khóa luồng phát cho hash: ${hash}`);

    process.env.HOST_URL = req.get('host');

    if (!token || token === "none") {
        return res.redirect(`magnet:?xt=urn:btih:${hash}`);
    }

    try {
        // TRUYỀN THAM SỐ THỨ 3: Nạp chuỗi magnetLink sạch vào bộ xử lý dữ liệu
        const directPlayUrl = await getTorBoxLink(hash, token, magnetLink);

        // Trường hợp file chưa hoàn thành tải hoặc lỗi cache hệ thống -> Chuyển luồng cứu hộ P2P
        if (!directPlayUrl || directPlayUrl === "PENDING") {
            console.log("[PLAY FALLBACK] Phim chưa hoàn tất cache. Chuyển tiếp luồng P2P Torrent...");
            return res.redirect(`magnet:?xt=urn:btih:${hash}`);
        }

        console.log(`[PIPING VIDEO] Đang truyền luồng dữ liệu nhị phân từ TorBox CDN sang Stremio Player...`);

        // Thu thập và forward toàn bộ tiêu đề mạng (đặc biệt là Range Headers để tua phim trên TV)
        const forwardHeaders = { 'Authorization': `Bearer ${token}` };
        if (req.headers.range) {
            forwardHeaders['Range'] = req.headers.range;
        }

        // Tạo luồng kết nối luồng thô (Stream Response) qua Axios
        const videoStreamResponse = await axios({
            method: 'get',
            url: directPlayUrl,
            headers: forwardHeaders,
            responseType: 'stream',
            timeout: 15000
        });

        // Sao chép nguyên bản Headers và Http Status Code từ TorBox CDN trả về cho thiết bị
        res.statusCode = videoStreamResponse.status;
        Object.keys(videoStreamResponse.headers).forEach(key => {
            res.setHeader(key, videoStreamResponse.headers[key]);
        });
        res.setHeader("Access-Control-Allow-Origin", "*");

        // Tiến hành Pipe truyền trực tiếp dòng dữ liệu thô vào trình phát của Stremio
        videoStreamResponse.data.pipe(res);

        videoStreamResponse.data.on('error', (streamErr) => {
            console.error("[STREAM PIPE ERROR] Đường truyền dữ liệu bị đứt quãng:", streamErr.message);
        });

    } catch (err) {
        console.error("[PLAY ENDPOINT ERROR] Lỗi hệ thống định tuyến mạng, tự động cứu hộ bằng Magnet:", err.message);
        return res.redirect(`magnet:?xt=urn:btih:${hash}`);
    }
});

// ======================================================================
// 5. MIDDLEWARE BÓC TÁCH TOKEN & KÍCH HOẠT ROUTER STREMIO SDK
// ======================================================================
app.use((req, res, next) => {
    const urlPath = req.path;
    
    // Mẹo bốc trích địa chỉ IP thật nội bộ của thiết bị đang gọi request tới Addon
    const userRealIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "";
    const cleanIp = userRealIp.split(',')[0].trim();

    console.log (`My IP: ${cleanIp}`);

    // 1. LUỒNG GHIN NHỚ: Mỗi khi thiết bị gọi bất kỳ lệnh nào từ URL cấu hình của bạn (như lướt Catalog)
    if (urlPath.includes("torbox_token=")) {
        try {
            const decodedPath = decodeURIComponent(urlPath);
            const URLParts = decodedPath.split("|");
            
            let torboxTokenVal = "none";
            URLParts.forEach(part => {
                const [key, value] = part.split("=");
                if (key && value && key.includes("torbox_token")) {
                    torboxTokenVal = value.split("/")[0].trim();
                }
            });

            if (torboxTokenVal !== "none" && cleanIp) {
                // Đóng dấu vân tay IP: Lưu Token của riêng thiết bị này vào bộ đệm RAM của request hiện tại
                DEVICES_SESSION_STORE[cleanIp] = torboxTokenVal;
                // Ép thêm vào biến môi trường chạy ngầm làm dự phòng chống trượt luồng
                req.userActiveToken = torboxTokenVal;
            }
        } catch (e) {
            console.error("[IP RECORD ERROR]", e.message);
        }
    }

    // 2. LUỒNG TRÍCH XUẤT: Nếu thiết bị gọi từ Cinemeta (URL thô /catalog/movie/tt...), 
    // ta tự động tìm kiếm Token cũ của chính IP này trong bảng băm để đắp vào request
    if (cleanIp && DEVICES_SESSION_STORE[cleanIp]) {
        req.userActiveToken = DEVICES_SESSION_STORE[cleanIp];
    }


    if (urlPath.includes("/catalog/") && urlPath.includes("torbox_token=")) {
        try {
            const decodedPath = decodeURIComponent(urlPath);
            const URLParts = decodedPath.split("|");
            
            let showAdultVal = "false";
            let torboxTokenVal = "none";

            URLParts.forEach(part => {
                const [key, value] = part.split("=");
                if (key && value) {
                    const cleanValue = value.split("/")[0].trim();
                    if (key.includes("show_adult")) showAdultVal = cleanValue.toLowerCase();
                    if (key.includes("torbox_token")) torboxTokenVal = cleanValue;
                }
            });

            const suffix = `||show_adult=${showAdultVal}||torbox_token=${torboxTokenVal}.json`;
            const activeCatalogIds = ["tpb_all", "tpb_action", "tpb_comedy", "tpb_horror", "tpb_scifi", "tpb_adult"];
            for (const id of activeCatalogIds) {
                //console.log(`[MASTER ROUTER] Catalog ID Độc lập: ${req.url}`)
                if (req.url.includes(`${id}.json`)) {
                    req.url = req.url.replace(`${id}.json`, `${id}${suffix}`);
                    break;
                }
            }

            // Gộp tất cả tham số nhúng thẳng vào cấu trúc Catalog ID hệ thống
            // if (req.url.includes("tpb_movies_catalog.json")) {
            //     req.url = req.url.replace(
            //         "tpb_movies_catalog.json", 
            //         `tpb_movies_catalog||show_adult=${showAdultVal}||torbox_token=${torboxTokenVal}.json`
            //     );
            //     console.log(`[MASTER ROUTER] Catalog ID Độc lập: ${req.url}`);
            // }
        } catch (e) {
            console.error("[MASTER ROUTER ERROR]", e.message);
        }
    }

    const stremioRouter = getRouter(addonInterface); 
    stremioRouter(req, res, next);
});


// ======================================================================
// 6. KHỞI CHẠY EXPRESS SERVER INTERFACE
// ======================================================================
// app.listen(PORT, "0.0.0.0", () => {
//     console.log(`\n======================================================`);
//     console.log(`🚀 [EXPRESS + STREMIO ROUTER INTEGRATED SUCCESSFULLY]`);
//     console.log(`🔗 Link cấu hình tự chế Local: http://localhost:${PORT}/configure`);
//     console.log(`🔗 Link manifest test thô: http://localhost:${PORT}/manifest.json`);
//     console.log(`======================================================\n`);
// });
// Chỉ chạy app.listen ở môi trường máy Local PC nhà để bạn test thử
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 [LOCAL SERVER RUNNING] ON PORT ${PORT}`);
    });
}

// 🌟 BẮT BUỘC CHO VERCEL: Xuất khẩu ứng dụng Express ra ngoài để Vercel tự động bọc luồng Serverless
module.exports = app;