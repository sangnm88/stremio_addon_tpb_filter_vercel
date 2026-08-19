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
    res.sendFile(path.join(__dirname, "style.css"));
});
// Mở endpoint cấp tệp tĩnh script.js ra internet công khai
app.get("/script.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.sendFile(path.join(__dirname, "script.js"));
});

// Mở endpoint cấp tệp tĩnh qrcode.js ra internet công khai
app.get("/qrcode.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.sendFile(path.join(__dirname, "qrcode.js"));
});

// ======================================================================
// 1. GIAO DIỆN CẤU HÌNH - ĐỌC TỪ FILE CONFIGURE.HTML RIÊNG BIỆT
// ======================================================================
app.get(["/", "/configure"], (req, res) => {
    console.log("[SERVER] Đang đọc và xuất file configure.html...");
    fs.readFile(path.join(__dirname, "configure.html"), "utf8", (err, data) => {
        if (err) {
            return res.status(500).send("Không thể tải trang cấu hình hệ thống.");
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(data);
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

// ======================================================================
// CẤU HÌNH PHÂN PHỐI MANIFEST TĨNH ÉP BỘ LỌC EXTRA (ĐỒNG BỘ TV VÀ MOBILE)
// ======================================================================
app.get(["/manifest.json", "/:config/manifest.json"], (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Mảng danh mục phim thường cốt lõi
    const CORE_GENRES = ["All", "Action", "Comedy", "Horror", "Sci-Fi"];

    const configParam = req.params.config || req.url;
    const decodedParam = decodeURIComponent(configParam);
    
    // Sao chép sâu đối tượng manifest gốc từ addon.js sang để xử lý biệt lập cho từng request
    let dynamicManifest = JSON.parse(JSON.stringify(addonInterface.manifest));

    // Kiểm tra trạng thái Checkbox của thiết bị hiện tại qua URL cấu hình
    if (decodedParam.includes("show_adult=true")) {
        console.log("[MANIFEST COMPILER] Bật Adult: Nạp thêm tùy chọn 18+ vào bộ lọc Extra.");
        
        // 1. Thêm vào mảng genres chính của catalog
        dynamicManifest.catalogs[0].genres = [...CORE_GENRES, "Adult 18+"];
        
        // 2. ÉP ĐỒNG BỘ: Chèn mục Adult vào danh sách options của bộ lọc extra để Tivi vẽ giao diện
        dynamicManifest.catalogs[0].extra = [
            {
                key: "genre",
                options: [...CORE_GENRES, "Adult 18+"],
                isRequired: false
            },
            { key: "search", isRequired: false },
            { key: "skip", isRequired: false }
        ];
    } else {
        console.log("[MANIFEST COMPILER] Tắt Adult: Cô lập bộ lọc chỉ chứa danh mục phim thường.");
        
        // Nếu chọn tắt ẩn trên giao diện config, bốc hơi hoàn toàn mục Adult 18+ khỏi hệ thống của thiết bị này
        dynamicManifest.catalogs[0].genres = CORE_GENRES;
        
        dynamicManifest.catalogs[0].extra = [
            {
                key: "genre",
                options: CORE_GENRES, // Tuyệt đối không chứa chữ Adult 18+
                isRequired: false
            },
            { key: "search", isRequired: false },
            { key: "skip", isRequired: false }
        ];
    }

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

            // Gộp tất cả tham số nhúng thẳng vào cấu trúc Catalog ID hệ thống
            if (req.url.includes("tpb_movies_catalog.json")) {
                req.url = req.url.replace(
                    "tpb_movies_catalog.json", 
                    `tpb_movies_catalog||show_adult=${showAdultVal}||torbox_token=${torboxTokenVal}.json`
                );
                console.log(`[MASTER ROUTER] Catalog ID Độc lập: ${req.url}`);
            }
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