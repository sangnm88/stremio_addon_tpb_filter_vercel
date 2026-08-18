FROM node:22-alpine

RUN apk update && apk add --no-cache git openssh-client nano

RUN npm install -g beamup-cli

RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5893

# Khởi tạo script entrypoint thông minh
# Tự động cấu hình SSH để bỏ qua bước xác thực vân tay (fingerprint) của host Beamup
RUN echo -e '#!/bin/sh\n\
# Ép Git tin tưởng thư mục làm việc bên trong container\n\
git config --global --add safe.directory /app\n\
\n\
# 🌟 SỬA ĐỔI MẤU CHỐT: Ép Git toàn cục phải sử dụng đích danh file khóa id_rsa khi thực hiện các lệnh git push/fetch\n\
git config --global core.sshCommand "ssh -i /root/.ssh/id_rsa -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"\n\
\n\
# TỰ ĐỘNG KHAI BÁO THÔNG TIN GIT ĐỂ KHÔNG BỊ HỎI LẠI\n\
git config --global user.email "anhsojack@gmail.com"\n\
git config --global user.name "Stremio Addon Developer"\n\
\n\
if [ -f /tmp/id_rsa ]; then\n\
  cp /tmp/id_rsa /root/.ssh/id_rsa\n\
  chown root:root /root/.ssh/id_rsa\n\
  chmod 600 /root/.ssh/id_rsa\n\
  # Cấu hình SSH tối ưu: Tự động thêm host và bỏ qua xác thực dấu vân tay nghiêm ngặt\n\
  echo -e "Host *\n  IdentityFile /root/.ssh/id_rsa\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null" > /root/.ssh/config\n\
  chmod 600 /root/.ssh/config\n\
fi\n\
\n\
if [ "$1" = "/start" ] || [ -z "$1" ]; then\n\
  exec npm start\n\
else\n\
  exec "$@"\n\
fi' > /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
