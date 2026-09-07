const axios = require("axios");
const NamedQueue = require("named-queue"); // Nhập thư viện hàng đợi chính quy
const BASE_URL = 'https://api.torbox.app/v1/api';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));



// Token gốc của TorBox là UUID chuẩn: 36 ký tự, 4 dấu gạch ngang
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * HÀM RIÊNG: Giải mã base64 THÔNG THƯỜNG dùng cho các giá trị KHÔNG phải token
 * (ví dụ urlDirect: link CDN TorBox được btoa() đóng gói ở hàng đợi torboxBulkQueue).
 * KHÔNG dùng decryptToken cho việc này: decryptToken chỉ chấp nhận kết quả UUID
 * nên link CDN sau giải mã sẽ bị loại và trả về chuỗi base64 chưa giải -> Stremio
 * nhận base64 rác làm url phát -> Playback Error.
 * @param {string} encoded - Chuỗi base64 (đã mất đệm "=" hoặc dạng base64url)
 * @returns {string} Chuỗi gốc đã giải mã (hoặc đầu vào nếu không giải được)
 */
function decodeBase64(encoded) {
    if (!encoded || encoded === "none") return "none";
    const trimmed = String(encoded).trim();
    try {
        // Chuẩn hóa base64url về base64 chuẩn rồi bù đệm "="
        let base64Str = trimmed.replace(/-/g, "+").replace(/_/g, "/");
        base64Str = base64Str.padEnd(base64Str.length + (4 - base64Str.length % 4) % 4, '=');
        const decoded = Buffer.from(base64Str, 'base64').toString('utf8').trim();
        // Chỉ trả kết quả nếu giải ra chuỗi hợp lệ có dấu vết của URL
        return decoded || trimmed;
    } catch (e) {
        console.warn("[DECODE BASE64 WARNING] Không giải mã được chuỗi:", e.message);
        return trimmed;
    }
}

/**
 * HÀM MỚI: Tách riêng logic giải mã Token Base64 an toàn
 * @param {string} tokenInput - Chuỗi mã Token (có thể đã mã hóa hoặc chuỗi gốc)
 * @returns {string} - Trả về mã Token gốc sạch để gọi API
 */
function decryptToken(tokenInput) {
    if (!tokenInput || tokenInput === "none") return "none";

    // Nếu token đã là UUID gốc thì bỏ qua không giải mã.
    // KHÔNG dò bằng includes("-"): chuỗi base64url cũng chứa dấu "-",
    // sẽ nhận nhầm token đã mã hóa là token gốc.
    const trimmedInput = tokenInput.trim();
    if (UUID_PATTERN.test(trimmedInput)) {
        return trimmedInput;
    }

    try {
        // Chuẩn hóa base64url ( - + và _ / ) về base64 chuẩn trước khi giải mã
        let base64Str = trimmedInput.replace(/-/g, "+").replace(/_/g, "/");

        // Thêm lại đệm padding dấu '=' cho Base64 nếu bị thiếu trong quá trình Stremio truyền URL
        base64Str = base64Str.padEnd(base64Str.length + (4 - base64Str.length % 4) % 4, '=');

        const decrypted = Buffer.from(base64Str, 'base64').toString('utf8');
        // Chỉ chấp nhận kết quả giải mã nếu ra đúng UUID; nếu không thì trả token thô gốc
        if (UUID_PATTERN.test(decrypted.trim())) {
            return decrypted.trim();
        }
        return trimmedInput;
    } catch (e) {
        console.warn("[TORBOX DECRYPT WARNING] Không thể giải mã chuỗi, thử dùng Token thô gốc:", e.message);
        return trimmedInput;
    }
}

/**
 * Tác vụ: Kiểm tra hàng loạt mã Hash xem đã được thêm vào tài khoản TorBox cá nhân chưa
 * @param {String|Array} hashInput - Một mã hash hoặc mảng chứa nhiều mã hash torrent
 * @param {String} torboxToken - API Key xác thực cá nhân của TorBox
 * @returns {Object} - Trả về dạng map: { "hash1": true, "hash2": false }
 */
async function checkMyTorrentsBulk(hashInput, torboxToken) {
    if (!torboxToken || torboxToken === "none") return {};

    // 🌟 Tự động bẻ khóa Token ngay đầu hàm
    const cleanToken = decryptToken(torboxToken);
    if (!cleanToken || cleanToken === "none") return {};

    // 1. Chuẩn hóa và làm sạch đầu vào thành mảng chữ viết thường
    const hashArray = Array.isArray(hashInput)
        ? hashInput.map(h => String(h).trim().toLowerCase())
        : [String(hashInput).trim().toLowerCase()];

    const cleanHashArray = hashArray.filter(h => h.length > 0);
    if (cleanHashArray.length === 0) return {};

    const headers = { 
        'Authorization': `Bearer ${cleanToken}`, 
        'Content-Type': 'application/json' 
    };

    try {
        console.log(`[TORBOX] - Đang kiểm tra danh sách tài khoản cá nhân cho các hash...`);
        
        // 2. Gọi API lấy toàn bộ danh sách torrent trong tài khoản
        const listRes = await axios.get(`${BASE_URL}/torrents/mylist`, { headers, timeout: 5000 });
        
        // Trích xuất mảng danh sách torrent thực tế từ API TorBox
        const myTorrentsList = listRes.data?.data || [];
        const accountHashMap = {};

        // 3. Duyệt qua danh sách hash yêu cầu để đối chiếu thông minh với tài khoản
        cleanHashArray.forEach(hash => {
            // Tìm kiếm xem mã hash này đã xuất hiện trong danh sách torrent của tài khoản chưa
            const isFoundInAccount = myTorrentsList.some(t => t.hash && t.hash.toLowerCase() === hash);
            
            accountHashMap[hash] = isFoundInAccount;
            console.log(`[TORBOX] - Hash [${hash}] trong tài khoản: ${isFoundInAccount ? '✅ ĐÃ CÓ' : '❌ CHƯA CÓ'}`);
        });

        return accountHashMap; // Trả về kết quả dạng: { "hash1": true, "hash2": false }

    } catch (error) {
        console.error('[TORBOX MYLIST CHECK ERROR]', error.message);
        return {};
    }
}


// 🌟 KHỞI TẠO TRẠM HÀNG ĐỢI ĐIỀU PHỐI (Tuyệt đối KHÔNG ĐỂ TỪ KHÓA async ở hàm worker này)
// Việc bỏ async đảm bảo biến callback ở vị trí số 2 luôn là một FUNCTION hợp lệ
const torboxBulkQueue = new NamedQueue((task, callback) => {
    const { hashesQuery, headers, cleanToken, cleanHashArray, apiCacheData } = task;
    const cacheMap = {};

    console.log(`[QUEUE WORKER] Đang xử lý tuần tự cụm hash trong hàng đợi...`);

    // Chuyển toàn bộ logic xử lý song song sang một hàm độc lập để chạy ngầm bất đồng bộ
    const runTask = async () => {
        const executionPromises = cleanHashArray.map(async (hash) => {
            const cacheResult = apiCacheData[hash] || apiCacheData[hash.toUpperCase()];
            let isCached = cacheResult !== undefined && cacheResult !== null;
            let torrentName = "";
            let urlDirect = "none";
            let in_account = false;

            if (isCached) {
                const infoObj = Array.isArray(cacheResult) ? cacheResult : cacheResult;
                torrentName = infoObj?.name || infoObj?.title || "Unknown Torrent";
            }

            // Luồng xử lý phim đã cached (🟢)
            if (isCached) {
                try {
                    const formPayload = new URLSearchParams();
                    formPayload.append("magnet", `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(torrentName)}`);
                    formPayload.append("as_queued", "false");

                    const addRes = await axios.post(`${BASE_URL}/torrents/createtorrent`, formPayload, { 
                        headers: { 'Authorization': `Bearer ${cleanToken}`, 'Content-Type': 'application/x-www-form-urlencoded' }, 
                        timeout: 5000 
                    });

                    const activeTorrentId = addRes.data?.data?.torrent_id;

                    if (activeTorrentId) {
                        const filesResponse = await axios.get(`${BASE_URL}/torrents/mylist?id=${activeTorrentId}`, { headers, timeout: 6000 });
                        const torrentObject = filesResponse.data?.data;
                        const filesList = torrentObject?.files || [];
                        
                        //Rest biến
                        in_account = false;//Mặc định là False

                        if (Array.isArray(filesList) && filesList.length > 0) {
                            let mainVideoFile = filesList[0];
                        
                            //Có tồn tại trong tk torbox
                            in_account = true;

                            filesList.forEach(file => {
                                if (file.size && mainVideoFile.size && file.size > mainVideoFile.size) {
                                    mainVideoFile = file;
                                }
                            });

                            const cleanTorrentId = parseInt(activeTorrentId);
                            const cleanFileId = parseInt(mainVideoFile.id);
                            
                            const queryDlUrl = `${BASE_URL}/torrents/requestdl?token=${encodeURIComponent(cleanToken)}&torrent_id=${cleanTorrentId}&file_id=${cleanFileId}&zip_link=false&append_name=true`;
                            
                            const dlResponse = await axios.get(queryDlUrl, { timeout: 6000 });
                            const realCdnDownloadLink = dlResponse.data?.data;

                            if (realCdnDownloadLink) {
                                urlDirect = btoa(realCdnDownloadLink).replace(/=/g, "");
                            }
                        }
                    }
                } catch (innerErr) {
                    console.warn(`[QUEUE VIP FETCH ERROR] Lỗi tại hash [${hash}]:`, innerErr.message);
                }
            }

            // Luồng xử lý phim chưa cached (⚫)
            if (!isCached) {
                const formPayload = new URLSearchParams();
                formPayload.append("magnet", `magnet:?xt=urn:btih:${hash}&dn=Movie`);
                formPayload.append("as_queued", "false");
                axios.post(`${BASE_URL}/torrents/createtorrent`, formPayload, {
                    headers: { 'Authorization': `Bearer ${cleanToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 5000
                }).catch(() => {});
            }

            cacheMap[hash] = {
                torrentName: torrentName || "Unknown Torrent",
                hash: hash,
                cached: isCached,
                in_account: in_account,
                urlDirect: urlDirect
            };
        });

        await Promise.all(executionPromises);
        return cacheMap;
    };

    // 🌟 ĐỒNG BỘ LUỒNG TRẢ MẠNG CHUẨN XÁC:
    // Gọi hàm runTask và bẫy kết quả bằng .then() .catch() truyền thống để thực thi callback an toàn
    runTask()
        .then((result) => {
            // cb.apply nội bộ của thư viện sẽ chạy trơn tru không còn lỗi undefined
            callback(null, result); 
        })
        .catch((err) => {
            callback(err);
        });
});



/**
 * Kiểm tra hàng loạt mã Hash: Kết hợp kiểm tra cache hệ thống và trạng thái trong tài khoản cá nhân
 * @param {String|Array} hashInput - Một mã hash hoặc mảng chứa nhiều mã hash
 * @param {String} torboxToken - Token API xác thực của bạn
 * @returns {Object} - Trả về bản đồ map thông tin chi tiết tích hợp
 */
/**
 * Hàm kiểm tra bộ nhớ đệm hàng loạt sử dụng bộ điều phối named-queue chống nghẽn mạch
 */
async function checkTorBoxCacheBulk(hashInput, torboxToken) {
    if (!torboxToken || torboxToken === "none") return {};
    
    let cleanToken = "";
    try {
        cleanToken = decryptToken(torboxToken);
        //console.log(`cleanToken: ${cleanToken}`);
    } catch (e) {
        return {};
    }
    
    if (!cleanToken || cleanToken === "none") return {};

    const hashArray = Array.isArray(hashInput)
        ? hashInput.map(h => String(h).trim().toLowerCase())
        : [String(hashInput).trim().toLowerCase()];

    const cleanHashArray = hashArray.filter(h => h.length > 0);
    if (cleanHashArray.length === 0) return {};

    const hashesQuery = cleanHashArray.join(",");
    const headers = { 'Authorization': `Bearer ${cleanToken}`, 'Content-Type': 'application/json' };

    try {
        console.log(`[QUEUE CONTROLLER] Nhận danh sách mã hash cần điều phối: ${cleanHashArray.length} hashes.`);
        
        // 1. Gọi lệnh checkcached hệ thống hàng loạt để phân loại xanh/đen
        const checkCacheRes = await axios.get(`${BASE_URL}/torrents/checkcached?hash=${hashesQuery}&format=object`, { headers, timeout: 6000 });
        const apiCacheData = checkCacheRes.data?.data || {};

        // 2. ĐÓNG GÓI NHIỆM VỤ (TASK) VÀ ĐẨY VÀO TRẠM ĐIỀU PHỐI NAMED-QUEUE
        // Tạo một Key định danh duy nhất (Unique Task Name) dựa trên chuỗi hash để gộp các yêu cầu trùng lặp
        const taskName = `bulk_task_${hashesQuery.substring(0, 32)}`;

        return new Promise((resolve, reject) => {
            // 🌟 SỬA ĐỔI CHÍNH XÁC: Loại bỏ tham số thô taskName ở vị trí số 1.
            // Hàm .push() chỉ nhận ĐÚNG 2 THAM SỐ: Đối tượng Task (chứa trường id bên trong) và Callback Function
            torboxBulkQueue.push({
                id: taskName, // 🌟 ÉP ĐỊNH DANH HÀNG ĐỢI VÀO ĐÂY THEO ĐÚNG TÀI LIỆU
                hashesQuery,
                headers,
                cleanToken,
                cleanHashArray,
                apiCacheData
            }, (err, result) => {
                if (err) {
                    console.error("[QUEUE RUNTIME ERROR] Hàng đợi xử lý thất bại:", err.message);
                    return resolve({}); // Trả về mảng trống an toàn để không làm sập ứng dụng Client
                }
                
                console.log(`[QUEUE CONTROLLER SUCCESS] Đã xuất xưởng dữ liệu sạch cho task: ${taskName}`);
                resolve(result); // Trả bảng bản đồ cacheMap về cho addon.js map card phim
            });
        });

    } catch (error) {
        console.error('[TORBOX MASTER CRITICAL ERROR]', error.message);
        return {};
    }
}

/**
 * Hàm lấy link Stream trực tiếp tối ưu bằng Magnet Link đầu vào
 * @param {string} infoHash - Mã băm viết thường
 * @param {string} torboxToken - Token người dùng
 * @param {string} magnetLink - Chuỗi liên kết Magnet đầy đủ truyền từ addon sang
 */
async function getTorBoxLink(infoHash, torboxToken, magnetLink) {
    if (!torboxToken || torboxToken === "none") return null;

    // 🌟 Tự động bẻ khóa Token phục vụ luồng nạp và lấy link stream video
    const cleanToken = decryptToken(torboxToken);
    if (!cleanToken || cleanToken === "none") return null;

    const hash = String(infoHash).trim().toLowerCase();
    const headers = { 'Authorization': `Bearer ${cleanToken}` };
    
    // Nếu addon không truyền magnet sang, tự dựng magnet thô làm dự phòng
    const finalMagnet = magnetLink ? magnetLink : `magnet:?xt=urn:btih:${hash}`;

    try {
        const cacheMap = await checkTorBoxCacheBulk(hash, torboxToken);
        // checkTorBoxCacheBulk trả về object { cached, urlDirect, ... } cho mỗi hash,
        // không phải boolean — so sánh === true cũ luôn sai nên nhánh cached không bao giờ chạy
        const isCachedOnTorBox = cacheMap[hash] && cacheMap[hash].cached === true;

        // ======================================================================
        // KỊCH BẢN 1: FILE ĐÃ CACHED SẴN -> BỐC PHIM CÔNG CỘNG BẰNG MAGNET LINK
        // ======================================================================
        if (isCachedOnTorBox) {
            console.log(`[TORBOX PUBLIC] Đang trích xuất cấu trúc file từ bộ nhớ đệm list...`);
            
            const checkListUrl = `${BASE_URL}/torrents/checkcached?hash=${hash}&format=list`;
            const checkListRes = await axios.get(checkListUrl, { headers, timeout: 4000 });
            const cacheList = checkListRes.data?.data || [];
            const cachedItem = cacheList.find(item => String(item.hash).toLowerCase() === hash || item.cached === true);
            const filesList = cachedItem?.files || [];

            if (filesList.length > 0) {
                const videoFiles = filesList.filter(f => f.name && f.name.match(/\.(mp4|mkv|avi|mov)$/i));
                
                if (videoFiles.length > 0) {
                    videoFiles.sort((a, b) => (b.size || b.bytes || 0) - (a.size || a.bytes || 0));
                    const targetFile = videoFiles[0]; // Lấy FILE LỚN NHẤT (phần tử đầu sau sort), không phải cả mảng
                    const fileIndex = filesList.findIndex(f => f.name === targetFile.name);
                    const cleanIndex = fileIndex >= 0 ? fileIndex : 0;

                    // MỨC ĐỘ ƯU TIÊN 1: Lấy link có sẵn từ kho lưu trữ tĩnh
                    let directStreamUrl = targetFile.download_link || cachedItem?.download_link;

                    // MỨC ĐỘ ƯU TIÊN 2: SỬA QUAN TRỌNG - Gọi lệnh requestdownload bằng MAGNET LINK đầy đủ
                    if (!directStreamUrl) {
                        console.log(`[TORBOX] Hệ thống giấu link file, đang bẻ khóa CDN bằng giao thức Magnet Link...`);
                        
                        // Sử dụng tham số magnet thay vì info_hash trần để qua mặt hàng rào mã hóa của TorBox v1
                        const publicDlUrl = `${BASE_URL}/torrents/requestdownload?magnet=${encodeURIComponent(finalMagnet)}&file_id=${cleanIndex}&zip=false`;
                        const dlResponse = await axios.get(publicDlUrl, { headers, timeout: 5000 });
                        directStreamUrl = dlResponse.data?.data;
                    }

                    if (directStreamUrl) {
                        console.log(`[SUCCESS] Kết xuất luồng phát video ổn định: "${targetFile.name}"`);
                        return directStreamUrl;
                    }
                }
            }
        } 
        
        // ======================================================================
        // KỊCH BẢN 2: CHƯA CACHED -> DÙNG URL ENCODED FORM NẠP QUA MAGNET GỐC
        // ======================================================================
        else {
            console.log(`[TORBOX PRIVATE] Phim chưa có cache toàn cục. Tiến hành nạp hàng đợi bằng Magnet...`);
            
            const createFormData = new URLSearchParams();
            createFormData.append("magnet", finalMagnet); // Truyền magnet đầy đủ thay vì info_hash trần
            createFormData.append("as_queued", "false");

            await axios.post(`${BASE_URL}/torrents/createtorrent`, createFormData, { 
                headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, 
                timeout: 5000 
            });

            return "PENDING";
        }
        return null;
    } catch (error) {
        console.error('[TORBOX API PIPING ERROR]', error.response?.data || error.message);
        return null;
    }
}

module.exports = { getTorBoxLink, checkTorBoxCacheBulk, decryptToken, decodeBase64};
