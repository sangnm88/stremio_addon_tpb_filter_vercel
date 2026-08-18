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
app.get("/manifest.json", (req, res) => {
    console.log("[SERVER] Xuất file manifest.json thô phục vụ kiểm tra hệ thống...");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.json(addonInterface.manifest);
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
    
    // Kiểm tra xem URL có chứa phân vùng token cấu hình hay không (Chấp nhận cả chuỗi chưa giải mã)
    if (urlPath.includes("torbox_token=")) {
        try {
            // 🌟 MẤU CHỐT: Giải mã URL Encoding toàn cục
            // Chuyển đổi chuỗi: /default_genre=All%7Ctorbox_token=xxx%7Cshow_adult=true/manifest.json
            // Thành chuỗi sạch: /default_genre=All|torbox_token=xxx|show_adult=true/manifest.json

            console.log(`[BEFORE DECODE SUCCESS] Chuỗi path trước khi giải mã: ${urlPath}`);
            const decodedPath = decodeURIComponent(urlPath);
            //console.log(`[DECODE SUCCESS] Chuỗi path sau khi giải mã: ${decodedPath}`);

            // Tiến hành bẻ gãy chuỗi phẳng theo dấu gạch đứng "|" như tư duy chính xác của bạn
            const URLParts = decodedPath.split("|");

            URLParts.forEach(part => {
                // Bẻ đôi cặp thuộc tính bằng dấu "="
                const [key, value] = part.split("=");
                
                if (key && value) {
                    // Nếu giá trị nằm ở cuối chuỗi và dính đuôi "/manifest.json", tách lấy phần chữ trước dấu "/"
                    // Ví dụ: "true/manifest.json" -> split("/") sẽ lấy được phần tử đầu tiên là "true"
                    const cleanValue = value.split("/")[0].trim();

                    if (key.includes("torbox_token") && cleanValue !== "none") {
                        process.env.CURRENT_TORBOX_TOKEN = cleanValue;
                        //console.log(`[PARSED VIP] CURRENT_TORBOX_TOKEN: ${process.env.CURRENT_TORBOX_TOKEN}`);
                    }
                    
                    if (key.includes("show_adult")) {
                        process.env.SHOW_ADULT_CONTENT = cleanValue.toLowerCase();
                        //console.log(`[PARSED VIP] SHOW_ADULT_CONTENT: ${process.env.SHOW_ADULT_CONTENT}`);
                    }
                }
            });
        } catch (err) {
            console.error("[DECODE SPLIT ERROR] Lỗi rã chuỗi giải mã mạng:", err.message);
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