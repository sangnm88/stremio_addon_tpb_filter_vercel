const axios = require("axios");
const cheerio = require("cheerio");

// ==========================================
// CẤU HÌNH ĐỊA CHỈ TRẠM CÀO DỮ LIỆU
// ==========================================
const isProduction = process.env.NODE_ENV === "production";


//Thêm đoạn này để test push lên BEAMUP

// ==========================================
// CẤU HÌNH HỆ THỐNG
// ==========================================
//const PROWLARR_URL = "https://apibay.org/q.php";//"http://prowlarr:9696/api/v1/search";
//const PROWLARR_API_KEY = "09f131ca355a44528ff32a87e38e47fa"; // SỬA DÒNG NÀY: Điền API Key Prowlarr của bạn

const MY_API = isProduction
    ? "https://tpb-vercel-scraper.vercel.app/api" 
    : "http://192.168.99.104:5050/api";

// Lên Production gọi Serverless API trên Vercel, ở nhà gọi Container Docker Local
const PROWLARR_URL = isProduction
    ? "https://TÊN_DỰ_ÁN_VÀ_API_VERCEL_CỦA_BẠN.vercel.app/api/search" 
    : "http://prowlarr:9696/api/v1/search";

const PROWLARR_API_KEY = isProduction
    ? "MÃ_MẬT_KHẨU_TỰ_CHẾ_CỦA_BẠN" 
    : "MÃ_API_KEY_PROWLARR_MÁY_LOCAL_NHÀ_BẠN";


// Danh sách các trang bản sao (Mirror/Proxy) ổn định của PirateBay dùng cho hàm Axios dự phòng
const TPB_PROXIES = [
    "https://tpb.party",
    "https://piratebayproxy.net",
    "https://thepiratebay.org",
    "https://thepiratebay10.org",
    "https://thepiratebay.zone",
    "https://piratebay.live"
];
/**
 * HÀM MỚI: Tra cứu thông tin chi tiết của Torrent từ Prowlarr dựa trên mã Hash trần
 * @param {string} pureHash - Mã băm viết thường của torrent
 * @returns {Object|null} - Trả về object chứa thông tin phim thực tế, hoặc null nếu lỗi
 */
/**
 * Hàm tra cứu thông tin chi tiết của Torrent từ Prowlarr dựa trên mã Hash trần
 * Được đặt gọn gàng trong tệp Util.js của bạn
 */
async function getProwlarrMetaByHash(pureHash) {
    if (!PROWLARR_API_KEY || PROWLARR_API_KEY.includes("API_KEY")) {
        console.error("[PROWLARR META ERROR] Chưa cấu hình API Key");
        return null;
    }

    try {
        const cleanHash = String(pureHash).trim().toLowerCase();
        console.log(`[PROWLARR HASH SEARCH] Đang thực hiện tra cứu thông tin cho mã Hash: ${cleanHash}`);

        // 1. Quét luồng phim lẻ (movie)
        const response = await axios.get(PROWLARR_URL, {
            // headers: { "X-Api-Key": PROWLARR_API_KEY, "Accept": "application/json" },
            headers: { "Accept": "application/json" },
            params: { type: "movie", info_hash: cleanHash },
            timeout: 5000
        });

        const results = response.data || [];
        let tvResults = [];

        // 2. Phương án dự phòng: Nếu phim lẻ không ra, quét sang luồng phim bộ (tvsearch)
        if (results.length === 0) {
            console.log(`[PROWLARR HASH SEARCH] Thử lại bằng bộ lọc TV-Series...`);
            const tvResponse = await axios.get(PROWLARR_URL, {
                headers: { "X-Api-Key": PROWLARR_API_KEY, "Accept": "application/json" },
                params: { type: "tvsearch", info_hash: cleanHash },
                timeout: 5000
            });
            tvResults = tvResponse.data || [];
        }
        
        // Gộp kết quả từ 2 nguồn dữ liệu
        const totalResults = [...results, ...tvResults];
        console.log(`[PROWLARR HASH SEARCH] Đã tìm thấy ${totalResults.length} dữ liệu khớp từ Prowlarr`);

        // Tìm duy nhất 1 phần tử khớp chính xác mã băm infoHash
        const matchedTorrent = totalResults.find(item => item && String(item.infoHash).toLowerCase() === cleanHash);
        console.log(`[] Lọc dữ liệu theo hash "${cleanHash}". Số dòng tìm được là : ${matchedTorrent ? matchedTorrent.length : 0}`)

        // Lấy đối tượng cuối cùng (Ưu tiên phần tử khớp băm, fallback lấy phần tử đầu tiên của mảng)
        const rawItem = matchedTorrent || (totalResults.length > 0 ? totalResults[0] : null);

        // Bảo vệ an toàn: Nếu cả 2 nguồn Prowlarr đều không tìm thấy tệp này, trả về null để addon chạy chế độ giả lập
        if (!rawItem) {
            console.log(`[PROWLARR HASH SEARCH] Không tìm thấy dữ liệu tệp trên Prowlarr cho hash: ${cleanHash}`);
            return null;
        }

        console.log(`[PROWLARR HASH SEARCH] Đã bóc tách thành công dữ liệu thô: ${JSON.stringify(rawItem, null, 2)}`);

        // BÓC TÁCH CÁC BIẾN AN TOÀN (Sửa lỗi ReferenceError do thiếu khai báo biến)
        const seeders = rawItem.seeders !== undefined ? rawItem.seeders : 0;
        const leechers = rawItem.leechers !== undefined ? rawItem.leechers : 0;
        const sizeInGB = rawItem.size ? (rawItem.size / 1024 / 1024 / 1024).toFixed(2) : "0.00";
        const publishDate = rawItem.publishDate ? new Date(rawItem.publishDate).toLocaleDateString('vi-VN') : "Không rõ";

        let magnet = rawItem.magnetUrl;
        if (!magnet) {
            magnet = `magnet:?xt=urn:btih:${cleanHash}&dn=${encodeURIComponent(rawItem.title)}`;
        }

        let resolution = "SD";
        const titleUpper = String(rawItem.title).toUpperCase();
        if (titleUpper.includes("4K") || titleUpper.includes("2160P") || titleUpper.includes("UHD")) resolution = "4K";
        else if (titleUpper.includes("1080P") || titleUpper.includes("FHD") || titleUpper.includes("BLURAY")) resolution = "1080p";
        else if (titleUpper.includes("720P") || titleUpper.includes("HD")) resolution = "720p";

        // SỬA LỖI MẤU CHỐT: Trả về trực tiếp 1 đối tượng duy nhất (Object), KHÔNG DÙNG .map()
        return {
            name: `${rawItem.title}\nS:${seeders} L:${leechers} (${sizeInGB} GB)`,
            title: `${rawItem.title}\n👤 S: ${seeders} | 👥 L: ${leechers}\n📦 Size: ${sizeInGB} GB\n🔌 Nguồn: Prowlarr (${rawItem.indexer || "TPB"})`,
            infoHash: cleanHash,
            resolution: resolution,
            sizeInGB: sizeInGB,
            size: rawItem.size,
            magnet: magnet,
            imdbId: rawItem.imdbId,
            indexer: rawItem.indexer,
            age: rawItem.age,
            publishDate: publishDate, // Bổ sung thêm ngày đăng để file addon.js bóc ra màn hình ngoài
            protocol: rawItem.protocol,
            fileName: rawItem.fileName,
            originalname: rawItem.name,
            originaltitle: rawItem.title
        };

    } catch (err) {
        console.error("[PROWLARR HASH LOOKUP EXCEPTION] Thất bại xử lý hàm Meta:", err.message);
        return null;
    }
}

// ==========================================
// HÀM 1: CÀO DỮ LIỆU BẰNG PROWLARR (ƯU TIÊN SỐ 1 - CHỐNG CLOUDFLARE)
// ==========================================
async function scrapeWithProwlarr(searchQuery, category, targetPage) {
    if (!PROWLARR_API_KEY || PROWLARR_API_KEY.includes("API_KEY")) {
        console.warn("[PROWLARR WARNING] Chưa cấu hình API Key cho Prowlarr.");
        return [];
    }

    try {
        console.log(`[PROWLARR ENGINE] Đang truy vấn từ khóa: "${searchQuery}" | Trang yêu cầu: ${targetPage}`);
        let prowlarrCategory = 2000; 
        if (category === 500 || category === "500") {
            prowlarrCategory = 6000;
        }

        const response = await axios.get(PROWLARR_URL, {
            headers: isProduction ? {
                "Accept": "application/json"
            } : 
            {
                 "X-Api-Key": PROWLARR_API_KEY 
            },
            params: {
                query: searchQuery,
                // ĐỒNG BỘ THAM SỐ NÂNG CAO:
                // Nếu lên Production, nạp 'category', 'key' xác thực bảo mật và 'page' nhảy trang của Vercel [13]
                // Nếu chạy ở Local, nạp 'categories' dải mảng chuẩn của Prowlarr
                ...(isProduction 
                    ? { category: prowlarrCategory, key: PROWLARR_API_KEY, page: targetPage } 
                    : { categories: prowlarrCategory }
                )
            },
            timeout: 9000
        });

        const results = response.data || [];
        if (results.length === 0) return [];

        console.log(`[PROWLARR] Dữ liệu cào cho từ khoá: ${JSON.stringify(results, null, 2)}`)

        return results.map(item => {
            let infoHash = item.infohash;
            let magnet = item.magnetUrl; // Lấy magnet gốc từ Prowlarr
            if (!infoHash && magnet) { // && item.magnetUrl
                const match = item.magnetUrl.match(/btih:([a-fA-F0-9]{40})/i);
                infoHash = match ? match[1] : null;
            }

            if (!infoHash) return null;

            // Nếu Prowlarr thiếu magnet, tự dựng magnet chuẩn bằng infoHash
            if (!magnet) {
                magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(item.title)}`;
            }

            const cleanHash = String(infoHash).toLowerCase().trim();

            let resolution = "SD";
            const titleUpper = String(item.title).toUpperCase();
            if (titleUpper.includes("4K") || titleUpper.includes("2160P") || titleUpper.includes("UHD")) resolution = "4K";
            else if (titleUpper.includes("1080P") || titleUpper.includes("FHD") || titleUpper.includes("BLURAY")) resolution = "1080p";
            else if (titleUpper.includes("720P") || titleUpper.includes("HD")) resolution = "720p";

            const indexer = "The Pirate Bay";
            const seeders = item.seeders !== undefined ? item.seeders : 0;
            const leechers = item.leechers !== undefined ? item.leechers : 0;
            const sizeInGB = item.size ? (item.size / 1024 / 1024 / 1024).toFixed(2) : "0.00";
            const status = item.status;

            // LẤY MÃ IMDB ID TỪ PROWLARR: Nếu kết quả trả về dạng số thô 12345, tự chèn thêm chữ "tt" ở đầu
            let rawImdb = item.imdb || "none";
            if (rawImdb !== "none" && !String(rawImdb).startsWith("tt")) {
                rawImdb = `tt${String(rawImdb).padStart(7, '0')}`;
            }

            // 🌟 MẤU CHỐT 1: Đóng gói toàn bộ thông tin gốc thành một chuỗi văn bản (Data Packing)
            // Ngăn cách bằng ký tự đặc biệt "||" để dễ bóc tách bằng lệnh .split() sau này
            const packedData = `${item.name}||${sizeInGB}||${seeders}||${leechers}||${indexer}||${resolution}||${rawImdb}`;

            return {
                packedData : packedData,// Gửi chuỗi đóng gói vào trường name
                name: item.title, 
                title: `👤 Seeders: ${seeders} | 👥 Leechers: ${leechers}\n📦 Dung lượng: ${sizeInGB} GB\n🔌 Nguồn: Prowlarr (${item.indexer || "TPB"})`,
                infoHash: cleanHash,
                magnet: item.magnetUrl || `magnet:?xt=urn:btih:${cleanHash}`,
                resolution: resolution,
                seeders: seeders // Giữ lại biến số phục vụ thuật toán Sort
            };

            // return {
            //     name: `${item.title}\nS:${seeders} L:${leechers} (${sizeInGB} GB)`,
            //     title: `${item.title}\n👤 S: ${seeders} | 👥 L: ${leechers}\n📦 Size: ${sizeInGB} GB\n🔌 Nguồn: Prowlarr (${item.indexer || "TPB"})`,
            //     infoHash: cleanHash,
            //     resolution: resolution,
            //     magnet: magnet, // THÊM TRƯỜNG NÀY: Lưu magnet link gốcs
            //     imdbId: item.imdbId,
            //     indexer: item.indexer,
            //     categories: item.categories,
            //     age: item.age,
            //     protocol: item.protocol,
            //     fileName: item.fileName,
            //     originalname: item.name,
            //     originaltitle: item.title
            // };
        }).filter(t => t !== null && t !== undefined && t.infoHash);

    } catch (err) {
        console.warn(`[PROWLARR ENGINE FAILED] Lỗi kết nối Prowlarr (${err.message}).`);
        return []; // Trả về mảng trống để kích hoạt luồng Fallback dự phòng
    }
}

// ==========================================
// HÀM 2: CÀO DỮ LIỆU BẰNG AXIOS TRỰC TIẾP (ƯU TIÊN SỐ 2 - DỰ PHÒNG)
// ==========================================
async function scrapeWithAxios(searchQuery, category, targetPage) {
    let cleanCategory = category;
    // if (typeof category === "string" && category.includes(",")) {
    //     cleanCategory = 200; 
    // }

    for (const baseUrl of TPB_PROXIES) {
        try {
            // SỬA ĐỊNH DẠNG URL: Thay thế số trang mặc định cố định '1' thành biến số trang 'targetPage' động
            // Cấu trúc URL tìm kiếm của PirateBay: /search/từ_khóa/số_trang/bộ_lọc_sort/mã_danh_mục
            const url = `${baseUrl}/search/${encodeURIComponent(searchQuery)}/${targetPage}/99/${cleanCategory}`;
            console.log(`[AXIOS FALLBACK CONNECT] Đang cào trang proxy thô: ${url}`);

            const response = await axios.get(url, {
                timeout: 6000, // Thử nhanh trong 6 giây, nếu lỗi đổi proxy ngay
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                }
            });

            if (response.data && typeof response.data === "string" && !response.data.includes("Bad Gateway") && !response.data.includes("Cloudflare")) {
                console.log(`[AXIOS SUCCESS] Cào thành công từ proxy: ${baseUrl}`);
                
                // Gọi hàm bóc tách Cheerio thô nguyên bản trước kia của bạn
                // Đảm bảo hàm parseHtmlToTorrents(response.data) vẫn nằm ở cuối file này của bạn
                const torrents = parseHtmlToTorrents(response.data); 
                return torrents;
            }
        } catch (err) {
            console.warn(`[AXIOS WARNING] Nguồn proxy ${baseUrl} thất bại (${err.message}). Thử trang tiếp theo...`);
        }
    }
    return [];
}
async function scrapeWithAPI(searchQuery, category, targetPage) {
    let cleanCategory = category;
    // if (typeof category === "string" && category.includes(",")) {
    //     cleanCategory = 200; 
    // }
    try {
        // SỬA ĐỊNH DẠNG URL: Thay thế số trang mặc định cố định '1' thành biến số trang 'targetPage' động
        // Cấu trúc URL tìm kiếm của PirateBay: /search/từ_khóa/số_trang/bộ_lọc_sort/mã_danh_mục
        //http://192.168.99.104:5050/api/search?query=missax&category=500

        let rawquery =`query=${searchQuery}&page=${targetPage}&category=${category}`;
        const encodeQuery = encodeURIComponent(rawquery);
        const url = `${MY_API}/search?${rawquery}`;
        console.log(`[AXIOS FALLBACK CONNECT] Đang cào trang proxy thô: ${url}`);

        const response = await axios.get(url, {
            timeout: 6000, // Thử nhanh trong 6 giây, nếu lỗi đổi proxy ngay
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (response.data) {
            console.log(`[AXIOS SUCCESS] Cào thành công từ proxy: ${url}`);
            
            // Gọi hàm bóc tách Cheerio thô nguyên bản trước kia của bạn
            // Đảm bảo hàm parseHtmlToTorrents(response.data) vẫn nằm ở cuối file này của bạn



            const torrents = response.data; 
            //console.log(`Message : ${torrents.message}`);
            console.log(`Page:  ${targetPage} | Dữ liệu thô từ scrapeWithAPI: ${JSON.stringify(torrents.data, null, 2)} `)

            return torrents.data;
        }
    } catch (err) {
        console.warn(`[AXIOS WARNING] Nguồn ${MY_API} thất bại (${err.message}).`);
    }
    return [];
}
// ==========================================
// HÀM ĐIỀU PHỐI CHÍNH (ĐƯỢC GỌI TỪ ADDON.JS)
// ==========================================
async function scrapeTPB(searchQuery, category, targetPage) {
    // 1. Thử cào bằng Prowlarr trước
    //let torrents = await scrapeWithProwlarr(searchQuery, category);

    let torrents = await scrapeWithAPI(searchQuery, category, targetPage); 
    //let torrents = await scrapeWithAxios(searchQuery, category, targetPage); 

    // 2. CƠ CHẾ CỨU HỘ LOCAL: Nếu chạy ở nhà mà Prowlarr sập/không có kết quả, tự gọi luồng Axios dự phòng
    // if (!isProduction && (!torrents || torrents.length === 0)) {
    //     console.log(`[FALLBACK LOCAL] Hệ thống cào chính không có kết quả. Kích hoạt bộ cào thô Axios...`);
    //     torrents = await scrapeWithAxios(searchQuery, category, targetPage);
    // }

    return torrents;
}
/**
 * Hàm bóc tách và tra cứu siêu dữ liệu thông minh kết hợp Cinemeta và chuỗi dữ liệu đóng gói
 */
/**
 * Hàm bóc tách và tra cứu siêu dữ liệu thông minh kết hợp Cinemeta và chuỗi dữ liệu đóng gói từ ID
 * @param {string} argsId - Chuỗi ID đầy đủ nhận từ args.id (Ví dụ: tpb:hash||title||size||...)
 */
async function getSmartMeta(type, argsId) {
    if (!argsId) return null;
    // 1. Phân tách chuỗi ID đóng gói thành các phần độc lập
    const idParts = argsId.replace("tpb:", "").split("||");
    const pureHash = idParts[0].toLowerCase().trim(); // Mã hash luôn ở vị trí đầu tiên

    // Endpoint chuẩn tra cứu thông tin phim của Cinemeta Stremio bằng IMDb ID
    const cinemetaUrl = `https://cinemeta-live.strem.io/meta/${type}/${pureHash}.json`;

    // Khởi tạo khung dữ liệu rã gói dự phòng (Fallback Data) từ các vị trí tiếp theo trong chuỗi ID
    let title = idParts[1] || "Nguồn Torrent PirateBay";
    let size = idParts[2] || "0.00";
    let seeders = idParts[3] || "0";
    let leechers = idParts[4] || "0";
    let indexer = idParts[5] || "TPB";
    let resolution = idParts[6] || "1080p";
    let imdbIdFromProwlarr = idParts[7] || "none"; // Bóc mã IMDb ID được đóng gói

    try {

        // 🚀 ƯU TIÊN 1: Nếu Prowlarr cấp mã IMDb ID hợp lệ, gọi thẳng Cinemeta tra cứu thông tin chuẩn rạp
        // if (imdbIdFromProwlarr && imdbIdFromProwlarr !== "none" && imdbIdFromProwlarr.startsWith("tt")) {
        //     console.log(`[CINEMETA LOOKUP VIA IMDB] Đang gọi Cinemeta API cho phim có mã ID: ${imdbIdFromProwlarr}`);        
        //     const metaRes = await axios.get(cinemetaUrl, { timeout: 3000 }).catch(() => null);
        //     const item = metaRes?.data?.meta;

        //     if (item) {
        //         console.log(`[SMART META SUCCESS] Đã lấy thành công data chuẩn rạp từ Cinemeta cho: ${item.name}`);
        //         return {
        //             hash: pureHash,
        //             name: item.name,
        //             year: item.year || "2026",
        //             imdbRating: item.imdbRating || "7.5",
        //             genres: item.genres || ["Action", "Thriller"],
        //             director: item.director || ["Unknown"],
        //             cast: item.cast || ["Unknown"],
        //             poster: item.poster,
        //             background: item.background,
        //             resolution: resolution; //Lấy mặc định
        //             // Kết hợp mô tả chuẩn rạp với thông tin tệp tin thực tế của bạn cho chuyên nghiệp
        //             description: `${item.description || ""}\n\n⚙️ THÔNG TIN FILE TORRENT:\n🔌 Nguồn: ${indexer} | 📦 Size: ${size} GB\n👤 S: ${seeders} | 👥 L: ${leechers}`
        //         };
        //     }
        // }

        // 🛟 ƯU TIÊN 2: Nếu IMDb không có hoặc Cinemeta lỗi mạng, tự động rã gói dùng data gốc Prowlarr
        console.log(`[SMART META FALLBACK] Không tìm thấy dữ liệu IMDb từ Cinemeta. Sử dụng dòng chữ rã gói...`);
        const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
        const extractedYear = yearMatch ? yearMatch[1] : "2026";
        const sizeInGB = size ? (size / 1024 / 1024 / 1024).toFixed(2) : "0.00";

        return {
            hash: pureHash,
            name: title,
            title: `👤 S: ${seeders} | 👥 L: ${leechers}\n📦 Dung lượng: ${size} GB\n🔌 Nguồn: Prowlarr (${indexer || "TPB"})`,
            year: extractedYear,
            imdbRating: "7.5",
            genres: [resolution, "Torrent", indexer],
            director: "Unknown",
            cast: [`Seeders: ${seeders}`, `Leechers: ${leechers}`],
            poster: "https://githubusercontent.com",
            background: "https://unsplash.com",
            resolution: resolution,//Lấy mặc định
            description: `🔌 Nguồn Indexer: ${indexer}\n📦 Dung lượng file: ${size} GB\n👤 Seeders: ${seeders} | 👥 Leechers: ${leechers}\n\nℹ️ Luồng dữ liệu bóc tách thô từ Prowlarr. Hãy chọn luồng phát VIP phía dưới để xem phim.`
            
        };

    } catch (err) {
        console.error("[getSmartMeta EXCEPTION ERROR]", err.message);
        return null;
    }
}

module.exports = { scrapeTPB, getProwlarrMetaByHash, getSmartMeta };

// 💡 LƯU Ý: Bạn hãy giữ nguyên hàm bóc tách Cheerio thô (parseHtmlToTorrents) cũ của bạn ở ngay bên dưới dòng này nhé!

/**
 * Hàm bóc tách HTML thô từ The Pirate Bay sang mảng torrent sạch
 * Tối ưu hóa bốc dữ liệu trực tiếp theo chỉ số 8 cột cố định của trang Proxy
 */
function parseHtmlToTorrents(htmlData) {
    if (!htmlData || typeof htmlData !== "string") return [];

    try {
        const cheerio = require("cheerio");
        const $ = cheerio.load(htmlData);
        const torrents = [];

        // Duyệt qua từng dòng tr trong bảng kết quả tìm kiếm (Bỏ qua dòng tiêu đề index = 0)
        $("table#searchResult tr").each((index, element) => {
            if (index === 0) return;

            // 🌟 SỬA ĐỔI CHÍNH: Lấy tất cả các thẻ con trực tiếp của dòng tr (Bao gồm cả th và td)
            // Việc này giúp bẻ gãy hoàn toàn lỗi đổi cấu trúc thẻ th mới của trang proxy
            const cells = $(element).children().filter(function() {
                return this.tagName === 'td' || this.tagName === 'th';
            });

            // Điều kiện bảo vệ: Một dòng chuẩn bắt buộc phải có đủ từ 7-8 cột trở lên
            if (cells.length < 7) return;

            // 🌟 1. BÓC TIÊU ĐỀ PHIM (CỘT 2 - INDEX 1)
            // Lấy thẻ 'a' đầu tiên nằm trong cột thứ 2 để trích xuất tên phim sạch
            const titleCell = $(cells[1]);
            const titleLink = titleCell.find("a").first();
            const title = titleLink.text().trim();

            // Cứu hộ: Nếu cột 2 bị trống tên, bỏ qua ngay dòng này
            if (!title) return;

            // 🌟 2. BÓC LINK MAGNET (CỘT 4 - INDEX 3)
            // Tìm chính xác thẻ 'a' có thuộc tính href bắt đầu bằng chuỗi "magnet:"
            const magnetCell = $(cells[3]);
            const magnetUrl = magnetCell.find("a[href^='magnet:']").attr("href");

            // Nếu thiếu magnet, tự dựng magnet chuẩn bằng infoHash
            if (!magnetUrl) {
                magnetUrl = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`;
            }

            // 🌟 3. BÓC DUNG LƯỢNG SIZE (CỘT 5 - INDEX 4)
            const sizeText = $(cells[4]).text().trim();
            let sizeInGB = "0.00";
            
            // Xử lý chuỗi dung lượng bằng Regex (Ví dụ: "4.5 GiB" hoặc "450 MiB")
            const sizeMatch = sizeText.match(/(\d+\.\d+|\d+)\s*(GiB|MiB|GB|MB)/i);
            if (sizeMatch) {
                const sizeVal = parseFloat(sizeMatch[1]);
                const sizeUnit = sizeMatch[2].toUpperCase();
                sizeInGB = sizeUnit.includes("G") ? sizeVal.toFixed(2) : (sizeVal / 1024).toFixed(2);
            }

            // 🌟 4. BÓC SỐ LƯỢNG SEEDERS (CỘT 6 - INDEX 5) VÀ LEECHERS (CỘT 7 - INDEX 6)
            const seeders = parseInt($(cells[5]).text().trim()) || 0;
            const leechers = parseInt($(cells[6]).text().trim()) || 0;

            // 🌟 5. TRÍCH XUẤT MÃ BẰM INFOHASH VIẾT THƯỜNG TỪ LUỒNG MAGNET LINK
            let infoHash = null;
            const hashMatch = magnetUrl.match(/btih:([a-fA-F0-9]{40})/i);
            infoHash = hashMatch ? hashMatch[1].toLowerCase() : null;

            const indexer = "The Pirate Bay";

            if (!infoHash) return;

            // 🌟 6. TỰ ĐỘNG PHÂN TÁCH ĐỘ PHÂN GIẢI (RESOLUTION) TỪ TIÊU ĐỀ
            let resolution = "1080p"; 
            const titleUpper = title.toUpperCase();
            if (titleUpper.includes("4K") || titleUpper.includes("2160P") || titleUpper.includes("UHD")) {
                resolution = "4K";
            } else if (titleUpper.includes("1080P") || titleUpper.includes("FHD") || titleUpper.includes("BLURAY")) {
                resolution = "1080p";
            } else if (titleUpper.includes("720P") || titleUpper.includes("HD")) {
                resolution = "720p";
            } else if (titleUpper.includes("SD") || titleUpper.includes("CAM") || titleUpper.includes("DVD")) {
                resolution = "SD";
            }

            // LẤY MÃ IMDB ID TỪ PROWLARR: Nếu kết quả trả về dạng số thô 12345, tự chèn thêm chữ "tt" ở đầu
            let rawImdb = "none";
            if (rawImdb !== "none" && !String(rawImdb).startsWith("tt")) {
                rawImdb = `tt${String(rawImdb).padStart(7, '0')}`;
            }

            // 🌟 7 MẤU CHỐT : Đóng gói toàn bộ thông tin gốc thành một chuỗi văn bản (Data Packing)
            // Ngăn cách bằng ký tự đặc biệt "||" để dễ bóc tách bằng lệnh .split() sau này
            const packedData = `${title}||${sizeInGB}||${seeders}||${leechers}||${indexer}||${resolution}||${rawImdb}`;
            const cleanHash = infoHash;

            torrents.push({
                packedData : packedData,// Gửi chuỗi đóng gói vào trường name
                name: title, 
                title: `👤 Seeders: ${seeders} | 👥 Leechers: ${leechers}\n📦 Dung lượng: ${sizeInGB} GB\n🔌 Nguồn: (${indexer || "TPB"})`,
                infoHash: cleanHash,
                magnet: magnetUrl || `magnet:?xt=urn:btih:${cleanHash}`,
                resolution: resolution,
                seeders: seeders // Giữ lại biến số phục vụ thuật toán Sort
            });
        });

        console.log(`[CELL PARSER SUCCESS] Trích xuất thành công ${torrents.length} dòng phim dựa trên thuật toán sơ đồ 8 cột.`);
        return torrents;

    } catch (parseErr) {
        console.error("[PARSE COLUMNS ERROR] Thất bại xử lý mảng ô dữ liệu td:", parseErr.message);
        return [];
    }
}


