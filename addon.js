const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const { scrapeTPB, getProwlarrMetaByHash, getSmartMeta } = require("./Util");
const { getTorBoxLink, checkTorBoxCacheBulk } = require("./torbox");

// Danh sách các thể loại phim cốt lõi luôn luôn hiển thị (Giữ nguyên của bạn)
const CORE_GENRES = ["All", "Action", "Comedy", "Horror", "Sci-Fi"];

const manifest = {
    id: "community.tpbconfigurableaddon",
    version: "4.0.0", // Nâng cấp phiên bản tích hợp TorBox
    name: "TPB Custom Filter Addon",
    description: "Searching torrent from TPB",
    resources: ["stream", "catalog", "meta"], 
    types: ["movie", "series"],
    idPrefixes: ["tt", "tpb:"], 
    catalogs: [
        {
            id: "tpb_movies_catalog",
            type: "movie",
            name: "TPB Movies",
            // 🌟 SỬA ĐỔI MẤU CHỐT 1: Khai báo mảng tĩnh đầy đủ để ÉP Tivi/Điện thoại hiển thị thanh menu chọn thể loại
            genres: ["All", "Action", "Comedy", "Horror", "Sci-Fi", "Adult 18+"],
            // 🌟 MẤU CHỐT SỬA ĐỔI CHÍNH ĐỂ PHÂN TRANG HOẠT ĐỘNG TRÊN STREMIO:
            // Sử dụng cặp thuộc tính extraSupported và extraRequired thay thế hoàn toàn mảng extra cũ [1]
            extraSupported: ["search", "genre", "skip"], // BẮT BUỘC: Thêm "skip" vào đây để kích hoạt cuộn trang vô hạn
            extraRequired: [] // Không bắt buộc người dùng phải chọn thuộc tính nào mới hiện catalog [1]

        }
    ],
    behaviorHints: {
        configurable: true // Thêm dòng này để kích hoạt nút Configure trên app Stremio
    },
    config: [
        {
            key: "torbox_token",
            type: "string",
            title: "Nhập TorBox API Key của bạn (Lấy tại torbox.app/dashboard -> Settings -> API):",
            required: true // Nếu không nhập thì addon tự động chạy torrent thô mặc định
        },
        {
            key: "default_genre",
            type: "select",
            title: "Chọn thể loại phim hiển thị mặc định khi mở ứng dụng:",
            options: ["All", "Action", "Comedy", "Horror", "Sci-Fi", "Adult 18+"],
            default: "All",
            required: true
        }
    ]
};

const builder = new addonBuilder(manifest);

// ==========================================
// XỬ LÝ CATALOG HANDLER (TỰ ĐỘNG GỘP 200 + 500 KHI SEARCH)
// ==========================================
builder.defineCatalogHandler(async (args) => {
    console.log(`[CATALOG] Đang gọi danh mục: ${args.id}`);

    // 🌟 CHÈN LUỒNG KIỂM TRA BẢO MẬT ADULT: 
    // Nếu catalog yêu cầu thuộc tính Adult 18+ mà biến cấu hình là "false", lập tức chặn không cho hiển thị
    const showAdultConfig = process.env.SHOW_ADULT_CONTENT || "false";
    // Nếu người dùng cố tình tìm cách truy cập tab Adult khi cấu hình đang tắt, chặn đứng lập tức
    if (args.extra?.genre === "Adult 18+" && showAdultConfig !== "true") {
        console.log("[SECURITY BLOCK] Chặn truy cập danh mục Adult 18+ theo cấu hình hệ thống.");
        return { metas: [] }; 
    }

    // BÓC TÁCH THAM SỐ PHÂN TRANG: Nếu mới vào thì skip = 0 (Trang 1)
    const skip = (args.extra && args.extra.skip) ? parseInt(args.extra.skip) : 0;
    
    // Quy đổi số lượng phần tử bỏ qua sang số TRANG chuẩn (Mỗi trang có 100 phim)
    // skip = 0 -> page = 1; skip = 100 -> page = 2; skip = 200 -> page = 3
    const targetPage = Math.floor(skip / 100) + 1;
    const basePage = Math.floor(skip / 30) + 1; // Tính ra trang bắt đầu của PirateBay

    let torrents = [];
    let allTorrents = [];
    
    let searchQuery ="2026";
    let tpbCategory = 200; 

    // KỊCH BẢN 1: Người dùng chủ động GÕ TỪ KHÓA vào ô tìm kiếm của Stremio
    if (args.extra && args.extra.search) {
        searchQuery = args.extra.search;
        console.log(`\n[CATALOG SEARCH ACTIVED] Đang gõ tìm kiếm từ khóa: "${searchQuery}"`);
        console.log(`[CATALOG] CHẾ ĐỘ: Quét đồng thời cả 2 danh mục (200 + 500) trên The Pirate Bay...`);


        tpbCategory = showAdultConfig == "true" ? "200,500" : "200";
        console.log(`Test showAdultConfig - tpbCategory: ${showAdultConfig}`);

    } 
    // KỊCH BẢN 2: Người dùng chỉ DUYỆT THỂ LOẠI trên tab Discover (Không gõ từ khóa)
    else {
        const preInstalledGenre = args.config && args.config.default_genre ? args.config.default_genre : "All";
        const activeGenre = args.extra && args.extra.genre ? args.extra.genre : preInstalledGenre;

        if (activeGenre === "Adult 18+") {
            tpbCategory = 500; 
        }
        console.log(`\n[CATALOG BROWSE] Người dùng đang duyệt danh mục. Thể loại đang chọn: "${activeGenre}"`);

        // Định dạng từ khóa ảo để tải dữ liệu trang chủ thể loại
        searchQuery = activeGenre === "All" || activeGenre === "Adult 18+" ? "2026" : activeGenre;
        console.log(`[CATALOG] Tải tự động cho thể loại: "${searchQuery}" | Danh mục TPB đơn lẻ: ${tpbCategory}`);

    }

    try {
        
        console.log(`[CATALOG PAGINATION] Gộp trang ngầm: Đang cào liên tiếp từ Trang ${basePage} đến Trang ${basePage + 3} của PirateBay...`);
        
        // Gọi liên tiếp 4 trang chạy song song bằng Promise.all để tối ưu tốc độ phản hồi cực nhanh
        const pagePromises = [
            scrapeTPB(searchQuery, tpbCategory, basePage),
            scrapeTPB(searchQuery, tpbCategory, basePage + 1),
            //scrapeTPB(searchQuery, tpbCategory, basePage + 2),
            //scrapeTPB(searchQuery, tpbCategory, basePage + 3)
        ];

        const pagesResults = await Promise.all(pagePromises);
        
        // Gộp tất cả các mảng dữ liệu của 4 trang lại thành một mảng duy nhất
        pagesResults.forEach(pageData => {
            if (Array.isArray(pageData)) {
                allTorrents = allTorrents.concat(pageData);
            }
        });

        console.log(`[CATALOG] Gộp thành công! Tổng số torrent thu được từ tìm kiếm: ${allTorrents.length}`);
    } catch (err) {
        console.error("[CATALOG SEARCH ERROR] Lỗi trong quá trình quét gộp danh mục:", err.message);
    }
    // Đoạn cuối hàm map xuất danh sách Card của defineCatalogHandler:
    // TRONG FILE addon.js -> defineCatalogHandler
    const metas = allTorrents.map(t => {
        // Biến t.name từ Util.js truyền sang đã là chuỗi chứa: tiêu_đề||dung_lượng||seeders||leechers||indexer||resolution
        const packedData = t.packedData; 
        const cleanTitle = packedData.split("||")[0]; // Cắt lấy tên phim sạch hiển thị ngoài trang Discover

        return {
            // ĐÓN_GÓI VÀO ID: Lưu chuỗi thông tin gốc đi kèm mã hash
            id: `tpb:${t.infoHash}||${packedData}`, 
            type: "movie",
            name: cleanTitle, 
            poster: "https://githubusercontent.com",
            description: `Dung lượng: ${packedData.split("||")[1]} GB | Seeders: ${packedData.split("||")[2]}`
        };
    });

    // Đóng gói mảng dữ liệu torrent thô thành định dạng Card hiển thị trong ứng dụng Stremio
    // const metas = torrents.map(t => {
    //     const cleanName = t.title.split('\n')[0]; 
    //     return {
    //         id: `tpb:${t.infoHash}`, 
    //         type: "movie",
    //         name: cleanName,
    //         title: t.title,
    //         //poster: "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg", //mặc định không có poster
    //         description: t.title,
    //         resolution: t.resolution,
    //         indexer: t.indexer
    //     };

    // });

    console.log (`Dữ liệu thô từ metas: ${JSON.stringify(metas, null, 2)}`);
    return { metas: metas };
});

// ==========================================
// SỬA MẤU CHỐT: XỬ LÝ META HANDLER CHO NGUỒN ID "tpb:"
// ==========================================
builder.defineMetaHandler(async (args) => {
    if (args.id && args.id.startsWith("tpb:")) {
        // TRUYỀN NGUYÊN BIẾN args.id: Hàm getSmartMeta sẽ tự bóc tách mã hash và rã gói dữ liệu
        const info = await getSmartMeta(args.type, args.id); 

        if (info) {
            return {
                meta: {
                    infoHash: info.hash,
                    id: args.id, // Giữ nguyên ID đóng gói để Stremio chuyển tiếp sang bước Stream
                    type: "movie",
                    name: info.name,
                    releaseInfo: String(info.year),
                    runtime: "120 min",
                    imdbRating: String(info.imdbRating),
                    genres: info.genres,
                    director: info.director,
                    cast: info.cast,
                    poster: info.poster,
                    background: info.background,
                    description: info.description
                }
            };
        }
    }
    return { meta: null };
});


// ==========================================
// XỬ LÝ STREAM HANDLER
// ==========================================
builder.defineStreamHandler(async (args) => {
    let allStreams = [];
    let imdbId = args.id;
    let seasonEpisodeSuffix = "";

    let emoji = "🎞️";

    // 1. Xử lý luồng dữ liệu độc lập cho Catalog riêng của bạn
    if (args.id && args.id.startsWith("tpb:")) {
        // TRUYỀN NGUYÊN BIẾN args.id để rã gói lấy thông tin dựng cột bên phải
        const info = await getSmartMeta(args.type, args.id);
        
        if (!info) {
            return { streams: [{ name: "🧲 [FALLBACK P2P]", title: "Lỗi giải mã cấu trúc dữ liệu.", infoHash: args.id.replace("tpb:", "").split("||")[0] }] };
        }

        const pureHash = info.hash; // Lấy mã hash sạch đã rã gói
        const userTorBoxToken = process.env.CURRENT_TORBOX_TOKEN || "none";
        const currentHost = process.env.HOST_URL || "localhost:7000";


        console.log(`Token bị mã hoá: ${userTorBoxToken}`)

        // Tạo link bẻ khóa truyền kèm tham số magnet link đầy đủ
        //const directPlayUrl = `http://${currentHost}/play/torbox/${pureHash}/${userTorBoxToken}?magnet=${encodeURIComponent(`magnet:?xt=urn:btih:${pureHash}&dn=${encodeURIComponent(info.name)}`)}`;

        if (info.resolution === "4K") emoji = "🌟 [4K UHD]";
        if (info.resolution === "1080p") emoji = "🎬 [1080p FHD]";
        if (info.resolution === "720p") emoji = "⚡ [720p HD]";

        let isCachedOnTorBox = false;
        let dynamicTitle = `🧲 Luồng phát P2P - Kéo torrent bằng mạng ngang hàng mạng nội bộ thiết bị.\n${info.name}\n\n${info.title}`;
        let dynamicName = `${emoji}`;

        // KIỂM TRA TRẠNG THÁI CACHED THỰC TẾ TRÊN HỆ THỐNG TORBOX
        if (userTorBoxToken && userTorBoxToken !== "none") {
            try {
                // Gọi hàm check bulk đơn lẻ tốc độ cao từ TorBox.js của bạn
                const cacheMap = await checkTorBoxCacheBulk(pureHash, userTorBoxToken);
                isCachedOnTorBox = cacheMap[pureHash].cached;
            } catch (err) {
                console.error("[STREAM HANDLER CACHE CHECK ERROR]", err.message);
                isCachedOnTorBox = false;
            }

            // ======================================================================
            // PHÂN PHỐI ĐẦU RA SANG STREMIO DỰA TRÊN KẾT QUẢ CHECK CACHED
            // ======================================================================
            if (isCachedOnTorBox) {
                // KỊCH BẢN A: PHIM ĐÃ CACHED SẴN -> Phát trực tiếp từ TorBox CDN (Trả về trường URL)
                console.log(`[PLAY STREAM] Luồng ${pureHash} đã có cache VIP.`);
                dynamicName = `${emoji}\nCached`;
                dynamicTitle = `${info.name}\n${info.title}`;

            } else {
                // KỊCH BẢN B: CHƯA CACHED HOẶC KHÔNG CÓ VIP -> Chuyển luồng P2P Torrent (Trả về trường infoHash)
                console.log(`[PLAY STREAM] Luồng ${pureHash} chưa cache hoặc không có Token VIP. Fallback sang giao thức P2P...`);
                dynamicName = `${emoji}\nP2P STREAM`
                dynamicTitle = `⚠️ Chưa Cache - Bấm Play hệ thống sẽ tự động thêm vào TorBox Cloud.\n${info.name}\n\n${info.title}`;
            }
        }
        //KHÔNG CÀI ĐẶT TORBOX
        else {
            
            dynamicName = `${emoji}\nP2P STREAM`;
            dynamicTitle = `🧲 Luồng phát P2P - Kéo torrent bằng mạng ngang hàng mạng nội bộ thiết bị\n${info.name}\n\n${info.title}`;

        }
        
        return {
            streams: [{
                infoHash : pureHash,
                name: dynamicName,
                title: dynamicTitle
                //url: directPlayUrl
            }]
        };
    }

    // Luồng phim/series đồng bộ từ Cinemeta của Stremio
    if (args.type === "series" && args.id.includes(":")) {
        const parts = args.id.split(":");
        imdbId = parts[0]; 
        const season = String(parts[1]).padStart(2, '0');
        const episode = String(parts[2]).padStart(2, '0');
        seasonEpisodeSuffix = ` S${season}E${episode}`;
    }

    try {
        const metaUrl = `https://cinemeta-live.strem.io/meta/${args.type}/${imdbId}.json`;
        const metaResponse = await axios.get(metaUrl);
        if (metaResponse.data && metaResponse.data.meta) {
            const movieTitle = metaResponse.data.meta.name + seasonEpisodeSuffix;

            allStreams = await scrapeTPB(movieTitle, 200,1);

            // Gọi bộ cào dữ liệu từ Prowlarr/Axios đã tối ưu ở các bước trước
            // const [videoStreams, adultStreams] = await Promise.all([
            //     scrapeTPB(movieTitle, 200,1),
            //     //scrapeTPB(movieTitle, 500,1)
            // ]);
            // allStreams = [...videoStreams, ...adultStreams];
        }
    } catch (e) {
        console.error("[STREAM ERROR]", e.message);
    }

    const resolutionWeights = { "4K": 40, "1080p HDR": 35, "1080p": 30, "720p": 20, "SD": 10 };

    if (allStreams.length === 0) {
        return { streams: [{ name: "TPB Tracker", title: "Không tìm thấy nội dung phù hợp.", url: "" }] };
    }

    // Lấy mã Token của TorBox trích xuất từ URL chạy ngầm
    const userTorBoxToken = process.env.CURRENT_TORBOX_TOKEN || "none";
    const currentHost = process.env.HOST_URL || "localhost:7000";

    // ======================================================================
    // KỊCH BẢN A: NGƯỜI DÙNG KHÔNG CÓ TORBOX VIP (KHÔNG NHẬP KEY / CHẠY TORRENT THƯỜNG)
    // ======================================================================
    if (!userTorBoxToken || userTorBoxToken === "none") {
        console.log(`[STREAM P2P] Không phát hiện cấu hình TorBox VIP. Trả về luồng phát Torrent truyền thống...`);

        allStreams = allStreams.map(stream => {
            let emoji = "🎞️";
            if (stream.resolution === "4K") emoji = "🌟 [4K UHD]";
            if (stream.resolution === "1080p") emoji = "🎬 [1080p FHD]";
            if (stream.resolution === "720p") emoji = "⚡ [720p HD]";

            return {
                name: `${emoji}\n${stream.name}`,
                title: `🧲 Luồng phát P2P - Kéo torrent bằng mạng ngang hàng mạng nội bộ thiết bị.\n${stream.name}\n\n${stream.title}`,
                infoHash: String(stream.infoHash).toLowerCase().trim(), // Trả về infoHash gốc để Stremio tự phát
                resolution: stream.resolution
            };
        });
    } 
    // ======================================================================
    // KỊCH BẢN B: NGƯỜI DÙNG CÓ CẤU HÌNH TORBOX VIP -> TIẾN HÀNH QUÉT CACHE HÀNG LOẠT
    // ======================================================================
    else {
        console.log(`[STREAM TORBOX VIP] Đang quét trạng thái bộ nhớ đệm cho danh sách torrent...`);
        try {
            const hashList = allStreams.filter(s => s.infoHash).map(s => String(s.infoHash).toLowerCase().trim());
            const globalCacheMap = await checkTorBoxCacheBulk(hashList, userTorBoxToken);

            console.log(`Đã tìm thấy ${hashList != null ? hashList.length : 0} link stream`);

            allStreams = allStreams.map(stream => {
                let emoji = "🎞️ No Cache";
                const currentHash = String(stream.infoHash).toLowerCase().trim();
                const isCachedOnTorBox = globalCacheMap[currentHash].cached;
                
                
                const movieName = stream.name;


                // MẤU CHỐT: Mã hóa an toàn chuỗi Magnet Link đầy đủ để truyền sang Express
                const encodedMagnet = stream.magnet ? encodeURIComponent(stream.magnet) : "";
                //const directPlayUrl = `http://${currentHost}/play/torbox/${currentHash}/${userTorBoxToken}?magnet=${encodedMagnet}`;
                //console.log(`directPlayUrl: ${directPlayUrl}`)
                if(isCachedOnTorBox)
                {
                    console.log(`hash: ${stream.infoHash} | isCachedOnTorBox: ${isCachedOnTorBox} | `);
                }
                
                if (isCachedOnTorBox) {
                    emoji = "📦[TORBOX]\nCached";
                    if (stream.resolution === "4K") emoji = "📦[TORBOX 4K]\nCached";
                    if (stream.resolution === "1080p") emoji = "📦 [TORBOX 1080p\nCached]";
                    if (stream.resolution === "720p") emoji = "📦 [TORBOX 720p\nCached]";
                    
                    return {
                        name: `${emoji}`,
                        title: `⚡ ${movieName}\n${stream.title}`,
                        //url: directPlayUrl,
                        infoHash: stream.infoHash,
                        resolution: stream.resolution
                    };
                } else {
                    emoji = "⏳ [ADD TO CLOUD]\nNo Cached";
                    if (stream.resolution === "4K") emoji = "⏳ [ADD TO CLOUD 4K]\nNo Cached";
                    if (stream.resolution === "1080p") emoji = "⏳ [ADD TO CLOUD 1080p]\nNo Cached";
                    if (stream.resolution === "720p") emoji = "⏳ [ADD TO CLOUD 720p]\nNo Cached";

                    return {
                        name: `${emoji}`,
                        title: `⚠️ Chưa Cache - Bấm Play hệ thống sẽ tự động thêm vào TorBox Cloud.\n${movieName}\n${stream.title}`,
                        //url: directPlayUrl,
                        //url: encodedMagnet,
                        infoHash: stream.infoHash,
                        resolution: stream.resolution
                    };
                }
            }).filter(s => s !== null); // Dọn sạch các stream lỗi rỗng khỏi mảng hiển thị cuối cùng;
        } catch (cacheGlobalErr) {
            console.log("[GLOBAL CACHE SCAN ERROR]", cacheGlobalErr.message);
        }

        console.log(`[STREAM TORBOX VIP] Hoàn tất quét trạng thái bộ nhớ đệm cho danh sách torrent...`);
    }

    // Thuật toán sắp xếp đa tầng: Ưu tiên link 📦 [TORBOX] -> Độ phân giải cao -> Số lượng Seeders
    allStreams.sort((a, b) => {
        const isA_Cached = a.name.includes("📦");
        const isB_Cached = b.name.includes("📦");
        if (isA_Cached !== isB_Cached) return isB_Cached - isA_Cached;

        const weightA = resolutionWeights[a.resolution] || 10;
        const weightB = resolutionWeights[b.resolution] || 10;
        if (weightB !== weightA) return weightB - weightA;

        // Nếu chất lượng bằng nhau, tiến hành so sánh số lượng Seeders (S:xxx)
        const matchA = (a.name || "").match(/S:(\d+)/);
        const matchB = (b.name || "").match(/S:(\d+)/);
        const sA = matchA ? parseInt(matchA[1]) : 0;
        const sB = matchB ? parseInt(matchB[1]) : 0;
        return sB - sA; 
    });

    return { streams: allStreams };
});



// Hàm bọc an toàn bổ sung tránh sập luồng xử lý chính khi quét danh mục người lớn
async function scrapeStreamsSafe(title, cat) {
    try { return await scrapeTPB(title, cat); } catch { return []; }
}

module.exports = builder.getInterface();
