const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Middleware xử lý dữ liệu gửi lên
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Định nghĩa đường dẫn lưu trữ cơ sở dữ liệu CSV trực tiếp trên Render
const thuMucData = path.join(__dirname, 'data');
const fileSanPham = path.join(thuMucData, 'products.csv');
const fileDonHang = path.join(thuMucData, 'orders.csv');

// Tự động khởi tạo thư mục dữ liệu nếu chưa có
if (!fs.existsSync(thuMucData)) {
    fs.mkdirSync(thuMucData, { recursive: true });
}

// Cấu hình Biến môi trường sao lưu tự động lên GitHub đám mây vĩnh viễn
const GITHUB_TOKEN = process.env.GH_TOKEN; 
const GITHUB_REPO = "CONGNGHETRIDUC/phan-mem-ban-hang";

/**
 * Hàm tự động đẩy tệp tin dữ liệu lên Kho lưu trữ GitHub đám mây
 */
async function saoLuuLenGitHub(tenFile, duongDanFile) {
    if (!GITHUB_TOKEN) return console.log("[Cloud Sync] Đang chạy ở môi trường Local hoặc chưa cấu hình Token, bỏ qua sao lưu GitHub.");
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/${tenFile}`;
        const noiDungBase64 = fs.readFileSync(duongDanFile, 'base64');
        
        let sha = null;
        try {
            const res = await axios.get(url, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) { /* File chưa tồn tại trên GitHub, sẽ tạo mới */ }

        await axios.put(url, {
            message: `Hệ thống Trí Đức tự động đồng bộ dữ liệu: ${new Date().toLocaleString()}`,
            content: noiDungBase64,
            sha: sha
        }, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });
        console.log(`[GitHub Cloud] Đã đồng bộ thành công file dữ liệu ${tenFile} lên mạng!`);
    } catch (error) {
        console.error("[GitHub Cloud Lỗi] Không thể sao lưu file:", error.message);
    }
}

// Router chính dẫn tới trang giao diện quản lý
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/**
 * Hàm phân tách dữ liệu và đọc tệp CSV an toàn tuyệt đối, chống đứng trang
 */
function docFileCSV(duongDanFile) {
    if (!fs.existsSync(duongDanFile)) return [];
    const noiDung = fs.readFileSync(duongDanFile, 'utf8').trim();
    if (!noiDung) return [];
    
    const dong = noiDung.split(/\r?\n/).filter(line => line.trim() !== "");
    if (dong.length <= 1) return []; 
    
    // Loại bỏ ký tự Byte Order Mark (BOM) nếu có để tránh lỗi tên tiêu đề cột
    const tieuDe = dong[0].replace(/^\uFEFF/, '').split(',').map(t => t.trim());
    
    return dong.slice(1).map(line => {
        const giaTri = line.split(',').map(v => v.trim());
        let doiTuong = {};
        tieuDe.forEach((cl, index) => {
            let val = giaTri[index] !== undefined ? giaTri[index] : "";
            // Tự động chuyển đổi chuỗi số thành dạng Number để tính toán tài chính chính xác
            doiTuong[cl] = (isNaN(val) || val === "") ? val : Number(val);
        });
        return doiTuong;
    });
}

/**
 * Hàm xuất và lưu mảng dữ liệu cấu trúc thành định dạng file CSV tiêu chuẩn
 */
function ghiFileCSV(duongDanFile, mangDuLieu) {
    if (mangDuLieu.length === 0) return;
    const tieuDe = Object.keys(mangDuLieu[0]).join(',');
    const cacDong = mangDuLieu.map(item => Object.values(item).join(','));
    // Thêm ký tự \ufeff ở đầu để phần mềm Excel hiển thị đúng font Tiếng Việt có dấu
    fs.writeFileSync(duongDanFile, '\ufeff' + [tieuDe, ...cacDong].join('\n'), 'utf8');
}

// API Lấy toàn bộ thông tin kho hàng và danh sách đơn bán hàng
app.get('/api/san-pham', (req, res) => res.json(docFileCSV(fileSanPham)));
app.get('/api/lich-su-don-hang', (req, res) => res.json(docFileCSV(fileDonHang)));

/**
 * API Nghiệp vụ Chốt đơn hàng và tự động trừ số lượng tồn kho
 */
app.post('/api/don-hang', async (req, res) => {
    const { skuMua, soLuongMua, tenKhachHang, sdtKhachHang } = req.body;
    let khoHang = docFileCSV(fileSanPham);
    let danhSachDonCu = docFileCSV(fileDonHang);

    let sanPham = khoHang.find(item => item.SKU === skuMua);
    if (!sanPham) return res.status(444).json({ error: "Không tìm thấy mã sản phẩm này trong kho!" });
    if (sanPham.Ton_Kho < soLuongMua) return res.status(400).json({ error: `Kho không đủ hàng! Hiện tại chỉ còn lại ${sanPham.Ton_Kho} sản phẩm.` });

    // Tính toán số liệu doanh thu và lợi nhuận thực tế dựa trên chênh lệch giá nhập/bán
    const doanhThuDon = sanPham.Gia_Ban * soLuongMua;
    const chiPhiVon = sanPham.Gia_Nhap * soLuongMua;
    const loiNhuanDon = doanhThuDon - chiPhiVon;

    // Tiến hành trừ lượng hàng tồn kho vật lý
    sanPham.Ton_Kho -= Number(soLuongMua);
    ghiFileCSV(fileSanPham, khoHang);

    // Tạo mã hóa đơn tuần tự định dạng tự động HD001, HD002...
    const maDonMoi = "HD" + String(danhSachDonCu.length + 1).padStart(3, '0');
    const bayGio = new Date();
    const thoiGian = `${bayGio.getDate()}/${bayGio.getMonth()+1}/${bayGio.getFullYear()} ${bayGio.getHours()}:${String(bayGio.getMinutes()).padStart(2, '0')}`;

    const thongTinDonHang = {
        maDon: maDonMoi,
        thoiGian: thoiGian,
        tenKhach: (tenKhachHang || "Khách vãng lai").replace(/,/g, ' '), // Lọc bỏ dấu phẩy tránh vỡ file CSV
        sdtKhach: sdtKhachHang || "---",
        tenSP: sanPham.Ten_San_Pham.replace(/,/g, ' '),
        soLuong: soLuongMua,
        doanhThu: doanhThuDon,
        loiNhuan: loiNhuanDon
    };

    danhSachDonCu.push(thongTinDonHang);
    ghiFileCSV(fileDonHang, danhSachDonCu);

    // Kích hoạt cơ chế sao lưu dữ liệu lập tức lên Cloud GitHub
    await saoLuuLenGitHub('orders.csv', fileDonHang);
    await saoLuuLenGitHub('products.csv', fileSanPham);

    res.json({ message: "Chúc mừng fen đã chốt đơn thành công!", donHang: thongTinDonHang });
});

/**
 * API Nghiệp vụ Nhập kho sản phẩm mới hoặc cộng dồn kho sản phẩm cũ
 */
app.post('/api/nhap-kho', async (req, res) => {
    const { SKU, Ten_San_Pham, Danh_Muc, Gia_Nhap, Gia_Ban, Ton_Kho, Toi_Thieu } = req.body;
    let khoHang = docFileCSV(fileSanPham);
    let sanPhamCoSan = khoHang.find(item => item.SKU === SKU);

    if (sanPhamCoSan) {
        // Nếu trùng mã SKU cũ, tiến hành cộng dồn số lượng và cập nhật bảng giá mới nhất
        sanPhamCoSan.Ton_Kho += Number(Ton_Kho);
        sanPhamCoSan.Gia_Nhap = Number(Gia_Nhap);
        sanPhamCoSan.Gia_Ban = Number(Gia_Ban);
    } else {
        // Nếu là mã SKU mới tinh, thêm một hàng mới vào cơ sở dữ liệu
        khoHang.push({ 
            SKU, 
            Ten_San_Pham: Ten_San_Pham.replace(/,/g,