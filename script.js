/* script.js - Logic xử lý cấu hình TPB Addon */

const eyeOpenPath = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
const eyeClosePath = '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-5.67c-.28 0-.56.03-.84.06l1.65 1.15c.67.33 1.41.53 2.2.53 2.76 0 5-2.24 5-5 0-.79-.2-1.53-.53-2.2L13.5 5.28c-.56-.1-.84-.15-.84-.15z"/>';

let qrcodeInstance = null;

// Khởi tạo mã QR Code mặc định sau khi toàn bộ tài nguyên trang được tải
window.addEventListener("DOMContentLoaded", () => {
    const qrcodeContainer = document.getElementById("qrcode");
    if (qrcodeContainer) {
        // 🌟 TỰ ĐỘNG: Lấy giao thức hiện tại (http:// hoặc https://) để sinh QR ban đầu
        const currentProtocol = window.location.protocol + "//";

        qrcodeInstance = new QRCode(qrcodeContainer, {
            text: generateConfigUrl(currentProtocol),
            width: 120,
            height: 120,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }
});

// 🌟 LUỒNG TỰ ĐỘNG MỞ APP KHI QUÉT QR CODE (TỰ ĐỘNG NHẬN DIỆN VÀ THAY THẾ)
window.addEventListener("DOMContentLoaded", () => {
    const currentUrl = window.location.href;
    
    if (currentUrl.includes("torbox_token=") && !currentUrl.includes("/manifest.json")) {
        console.log("[QR AUTO INTEGRATION] Thiết bị vừa quét mã QR thành công!");
        
        // 🌟 TỰ ĐỘNG: Bốc chính xác giao thức đang chạy để thay thế sạch sẽ sang stremio://
        const currentProtocol = window.location.protocol + "//";
        const stremioLink = currentUrl.replace(currentProtocol, "stremio://");
        
        setTimeout(() => {
            window.location.href = stremioLink;
        }, 1000);
    }
});

// Hàm xử lý lật ẩn/hiện mật khẩu token
function toggleTokenVisibility() {
    const tokenInput = document.getElementById("token");
    const eyeIcon = document.getElementById("eyeIcon");
    if (tokenInput.type === "password") {
        tokenInput.type = "text";
        eyeIcon.innerHTML = eyeClosePath;
    } else {
        tokenInput.type = "password";
        eyeIcon.innerHTML = eyeOpenPath;
    }
}

// Hàm đóng gói dữ liệu chuỗi cấu hình bảo mật
function generateConfigUrl(protocolPrefix) {
    const genre = document.getElementById("genre").value;
    const token = document.getElementById("token").value || "none";
    const showAdult = document.getElementById("adult_content").checked ? "true" : "false";
    const currentHost = window.location.host;
    
    const encryptedToken = btoa(token).replace(/=/g, ""); 
    const configPath = `default_genre=${genre}|torbox_token=${encryptedToken}|show_adult=${showAdult}`;
    
    return `${protocolPrefix}${currentHost}/${configPath}/manifest.json`;
}

// 🌟 TỰ ĐỘNG: Cập nhật hình dạng mã QR theo giao thức thực tế của trình duyệt
function updateQRCode() {
    if (qrcodeInstance) {
        const currentProtocol = window.location.protocol + "//"; // Tự nhận diện http:// hoặc https://
        const newUrl = generateConfigUrl(currentProtocol);
        qrcodeInstance.clear();
        qrcodeInstance.makeCode(newUrl);
    }
}


// Hàm xử lý nút cài đặt trực tiếp vào ứng dụng Stremio Client
function installAddon() {
    window.location.href = generateConfigUrl("stremio://");
}

// Hàm xử lý đóng gói và sao chép đường dẫn manifest.json HTTPS công khai vào Clipboard
function copyManifestLink() {
    const httpsUrl = generateConfigUrl("https://");
    const copyBtn = document.getElementById("copyBtn");

    navigator.clipboard.writeText(httpsUrl).then(() => {
        copyBtn.innerText = "ĐÃ SAO CHÉP THÀNH CÔNG ✔";
        copyBtn.classList.add("success");
        setTimeout(() => {
            copyBtn.innerText = "SAO CHÉP LINK MANIFEST";
            copyBtn.classList.remove("success");
        }, 2500);
    }).catch(err => {
        console.error("Lỗi trích xuất Clipboard:", err);
        alert("Hãy tự sao chép đường link này:\n" + httpsUrl);
    });
}

