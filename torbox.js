const axios = require("axios");

const BASE_URL = 'https://api.torbox.app/v1/api';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * HÀM MỚI: Tách riêng logic giải mã Token Base64 an toàn
 * @param {string} tokenInput - Chuỗi mã Token (có thể đã mã hóa hoặc chuỗi gốc)
 * @returns {string} - Trả về mã Token gốc sạch để gọi API
 */
function decryptToken(tokenInput) {
    if (!tokenInput || tokenInput === "none") return "none";
    
    // Nếu token đã là định dạng gốc (chứa dấu gạch ngang chuẩn UUID), bỏ qua không giải mã
    if (tokenInput.includes("-")) {
        return tokenInput.trim();
    }

    try {
        // Thêm lại đệm padding dấu '=' cho Base64 nếu bị thiếu trong quá trình Stremio truyền URL
        let base64Str = tokenInput.trim();
        base64Str = base64Str.padEnd(base64Str.length + (4 - base64Str.length % 4) % 4, '=');
        
        const decrypted = Buffer.from(base64Str, 'base64').toString('utf8');
        console.log(`Mã token: ${decrypted}`)
        return decrypted.trim();
    } catch (e) {
        console.warn("[TORBOX DECRYPT WARNING] Không thể giải mã chuỗi, thử dùng Token thô gốc:", e.message);
        return tokenInput.trim();
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

/**
 * HÀM KIỂM TRA CACHED HÀNG LOẠT (Dùng cho cả addon.js và nội bộ getTorBoxLink)
 * @param {Array|string} hashInput - Mảng các mã hash hoặc chuỗi hash ngăn cách bằng dấu phẩy
 * @param {string} torboxToken - API Key của người dùng
 * @returns {Object} - Trả về bản đồ trạng thái phẳng dạng { "hash1": true, "hash2": false }
 */
/**
 * Kiểm tra hàng loạt mã Hash: Kết hợp kiểm tra cache hệ thống và trạng thái trong tài khoản cá nhân
 * @param {String|Array} hashInput - Một mã hash hoặc mảng chứa nhiều mã hash
 * @param {String} torboxToken - Token API xác thực của bạn
 * @returns {Object} - Trả về bản đồ map thông tin chi tiết tích hợp
 */
async function checkTorBoxCacheBulk(hashInput, torboxToken) {
    if (!torboxToken || torboxToken === "none") return {};
    
     // 🌟 Tự động bẻ khóa Token ngay đầu hàm check cached
    const cleanToken = decryptToken(torboxToken);
    if (!cleanToken || cleanToken === "none") return {};

    // 1. Chuẩn hóa và làm sạch đầu vào thành Mảng chữ viết thường
    const hashArray = Array.isArray(hashInput)
        ? hashInput.map(h => String(h).trim().toLowerCase())
        : [String(hashInput).trim().toLowerCase()];

    const cleanHashArray = hashArray.filter(h => h.length > 0);
    if (cleanHashArray.length === 0) return {};

    const hashesQuery = cleanHashArray.join(",");
    const headers = { 
        'Authorization': `Bearer ${cleanToken}`, 
        'Content-Type': 'application/json' 
    };

    try {
        console.log(`[TORBOX BULK] - Bắt đầu kiểm tra tích hợp cho các hash: ${hashesQuery}`);
        
        // Kích hoạt gọi song song cả 2 API cùng lúc để tăng tốc độ phản hồi hệ thống
        const [checkCacheRes, myListRes] = await Promise.all([
            axios.get(`${BASE_URL}/torrents/checkcached?hash=${hashesQuery}&format=object`, { headers, timeout: 6000 }),
            axios.get(`${BASE_URL}/torrents/mylist`, { headers, timeout: 6000 })
        ]);

        // 2. Xử lý và chuẩn hóa dữ liệu Cache toàn cục (System Cache)
        const apiCacheData = checkCacheRes.data?.data || {};
        const lowerCaseCacheData = {};
        
        Object.keys(apiCacheData).forEach(key => {
            // ĐÃ SỬA LỖI TẠI ĐÂY: Gán chuẩn xác giá trị dựa theo biến apiCacheData
            lowerCaseCacheData[key.toLowerCase()] = apiCacheData[key];
        });

        // 3. Xử lý và chuẩn hóa dữ liệu Danh sách tài khoản cá nhân (My Torrent)
        const myTorrentsList = myListRes.data?.data || [];
        const accountHashMap = {};
        
        myTorrentsList.forEach(t => {
            if (t.hash) {
                // Lưu lại thông tin ID và đối tượng torrent cá nhân theo Key là mã hash viết thường
                accountHashMap[t.hash.toLowerCase()] = t;
            }
        });

        const cacheMap = {};

        // 4. Duyệt qua danh sách mã băm ban đầu để gộp dữ liệu thông minh
        cleanHashArray.forEach(hash => {
            const cacheResult = lowerCaseCacheData[hash];
            const accountResult = accountHashMap[hash]; // Kiểm tra xem hash này có trong tài khoản không
            
            // Khởi tạo các giá trị mặc định cho form biểu mẫu
            let isCached = false;
            let torrentName = "";
            let torrentSize = 0;

            // Bóc tách thông tin từ System Cache nếu có
            if (cacheResult !== undefined && cacheResult !== null) {
                if (Array.isArray(cacheResult) && cacheResult.length > 0) {
                    const info = cacheResult[0];
                    isCached = true;
                    torrentName = info.name || info.title || "";
                    torrentSize = info.size !== undefined ? info.size : (info.sizee || 0);
                } else if (typeof cacheResult === 'object' && !Array.isArray(cacheResult)) {
                    isCached = cacheResult.cached !== undefined ? cacheResult.cached === true : true;
                    torrentName = cacheResult.name || cacheResult.title || "";
                    torrentSize = cacheResult.size !== undefined ? cacheResult.size : (cacheResult.sizee || 0);
                } else {
                    isCached = cacheResult === true;
                }
            }

            // Nếu cache hệ thống trống nhưng trong tài khoản cá nhân đã có, ta lấy tên/size từ tài khoản đắp vào
            if (accountResult) {
                if (!torrentName) torrentName = accountResult.name || "";
                if (!torrentSize) torrentSize = accountResult.size || 0;
            }

            // ĐÓNG GÓI GỘP DỮ LIỆU ĐẦY ĐỦ THÔNG TIN
            cacheMap[hash] = {
                torrentName: torrentName,
                hash: hash,
                cached: isCached, // Trạng thái đã cache trên hệ thống TorBox hay chưa (true/false)
                in_account: accountResult !== undefined, // Trạng thái đã add vào tài khoản cá nhân chưa (true/false)
                account_details: accountResult ? {
                    id: accountResult.id, // ID Torrent cá nhân để gọi lấy link stream sau này
                    name: accountResult.name,
                    progress: accountResult.progress
                } : null
            };

            console.log(`[TORBOX INTEGRATION LOG] - Hash [${hash}] | Cached: ${cacheMap[hash].cached} | In Account: ${cacheMap[hash].in_account}`);
        });

        console.log(`[TORBOX BULK] - Kết quả gộp tích hợp hoàn chỉnh:`, JSON.stringify(cacheMap, null, 2));
        return cacheMap; 
        
    } catch (error) {
        console.log('[TORBOX BULK INTEGRATION ERROR]', error.message);
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
        const isCachedOnTorBox = cacheMap[hash] === true;

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
                    const targetFile = videoFiles;
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

module.exports = { getTorBoxLink, checkTorBoxCacheBulk };
