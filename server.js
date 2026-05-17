const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const thuMucData = path.join(__dirname, 'data');
const fileSanPham = path.join(thuMucData, 'products.csv');
const fileDonHang = path.join(thuMucData, 'orders.csv');

if (!fs.existsSync(thuMucData)) {
    fs.mkdirSync(thuMucData, { recursive: true });
}

const GITHUB_TOKEN = process.env.GH_TOKEN; 
const GITHUB_REPO = "CONGNGHETRIDUC/phan-mem-ban-hang";

async function saoLuuLenGitHub(tenFile, duongDanFile) {
    if (!GITHUB_TOKEN) return console.log("Chạy ở máy nhà hoặc chưa cấu hình Token, bỏ qua sao lưu Cloud.");
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/${tenFile}`;
        const noiDungBase64 = fs.readFileSync(duongDanFile, 'base64');
        
        let sha = null;
        try {
            const res = await axios.get(url, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) { /* File chưa tồn tại */ }

        await axios.put(url, {
            message: `Tự động cập nhật nhật ký đơn hàng: ${new Date().toLocaleString()}`,
            content: noiDungBase64,
            sha: sha
        }, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });
        console.log(`[GitHub] Đã đồng bộ thành công file ${tenFile} lên đám mây vĩnh viễn!`);
    } catch (error) {
        console.error("[GitHub Lỗi] Không thể sao lưu file:", error.message);
    }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==================== HÀM XỬ LÝ CSV TỰ ĐỘNG KHÔNG LỖI ====================
function docFileCSV(duongDanFile) {
    if (!fs.existsSync(duongDanFile)) return [];
    const noiDung = fs.readFileSync(duongDanFile, 'utf8').trim();
    if (!noiDung) return [];
    const dong = noiDung.split(/\r?\n/);
    if (dong.length <= 1 || dong[0] === "") return []; 
    const tieuDe = dong[0].split(',').map(t => t.trim());
    
    return dong.slice(1).map(line => {
        if (!line || !line.trim()) return null;
        const giaTri = line.split(',').map(v => v.trim());
        let doiTuong = {};
        tieuDe.forEach((cl, index) => {
            let val = giaTri[index] !== undefined ? giaTri[index] : "";
            doiTuong[cl] = (isNaN(val) || val === "") ? val : Number(val);
        });
        return doiTuong;
    }).filter(item => item !== null);
}

function ghiFileCSV(duongDanFile, mangDuLieu) {
    if (mangDuLieu.length === 0) return;
    const tieuDe = Object.keys(mangDuLieu[0]).join(',');
    const cacDong = mangDuLieu.map(item => Object.values(item).join(','));
    fs.writeFileSync(duongDanFile, '\ufeff' + [tieuDe, ...cacDong].join('\n'), 'utf8');
}

// ==================== HỆ THỐNG API ĐỒNG BỘ ====================
app.get('/api/san-pham', (req, res) => res.json(docFileCSV(fileSanPham)));

// API Lấy toàn bộ danh sách lịch sử đơn hàng để vẽ bảng
app.get('/api/lich-su-don-hang', (req, res) => res.json(docFileCSV(fileDonHang)));

app.post('/api/don-hang', async (req, res) => {
    const { skuMua, soLuongMua, tenKhachHang, sdtKhachHang } = req.body;
    let khoHang = docFileCSV(fileSanPham);
    let danhSachDonCu = docFileCSV(fileDonHang);

    let sanPham = khoHang.find(item => item.SKU === skuMua);
    if (!sanPham) return res.status(444).json({ error: "Không tìm thấy mã sản phẩm!" });
    if (sanPham.Ton_Kho < soLuongMua) return res.status(400).json({ error: `Kho không đủ! Còn ${sanPham.Ton_Kho} cái.` });

    const doanhThuDon = sanPham.Gia_Ban * soLuongMua;
    const chiPhiVon = sanPham.Gia_Nhap * soLuongMua;
    const loiNhuanDon = doanhThuDon - chiPhiVon;

    sanPham.Ton_Kho -= Number(soLuongMua);
    ghiFileCSV(fileSanPham, khoHang);

    const maDonMoi = "HD" + String(danhSachDonCu.length + 1).padStart(3, '0');
    const bayGio = new Date();
    const thoiGian = `${bayGio.getDate()}/${bayGio.getMonth()+1}/${bayGio.getFullYear()} ${bayGio.getHours()}:${String(bayGio.getMinutes()).padStart(2, '0')}`;

    const thongTinDonHang = {
        maDon: maDonMoi,
        thoiGian: thoiGian,
        tenKhach: (tenKhachHang || "Khách vãng lai").replace(/,/g, ' '),
        sdtKhach: sdtKhachHang || "---",
        tenSP: sanPham.Ten_San_Pham.replace(/,/g, ' '),
        soLuong: soLuongMua,
        doanhThu: doanhThuDon,
        loiNhuan: loiNhuanDon
    };

    danhSachDonCu.push(thongTinDonHang);
    ghiFileCSV(fileDonHang, danhSachDonCu);

    await saoLuuLenGitHub('orders.csv', fileDonHang);
    await saoLuuLenGitHub('products.csv', fileSanPham);

    res.json({ message: "Chốt đơn thành công!", donHang: thongTinDonHang });
});

app.post('/api/nhap-kho', async (req, res) => {
    const { SKU, Ten_San_Pham, Danh_Muc, Gia_Nhap, Gia_Ban, Ton_Kho, Toi_Thieu } = req.body;
    let khoHang = docFileCSV(fileSanPham);
    let sanPhamCoSan = khoHang.find(item => item.SKU === SKU);

    if (sanPhamCoSan) {
        sanPhamCoSan.Ton_Kho += Number(Ton_Kho);
        sanPhamCoSan.Gia_Nhap = Number(Gia_Nhap);
        sanPhamCoSan.Gia_Ban = Number(Gia_Ban);
    } else {
        khoHang.push({ 
            SKU, 
            Ten_San_Pham: Ten_San_Pham.replace(/,/g, ' '), 
            Danh_Muc: Danh_Muc.replace(/,/g, ' '), 
            Gia_Nhap, Gia_Ban, Ton_Kho, Toi_Thieu 
        });
    }
    
    ghiFileCSV(fileSanPham, khoHang);
    await saoLuuLenGitHub('products.csv', fileSanPham);
    res.json({ message: `Đồng bộ nhập kho mã hàng ${SKU} thành công!` });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HỆ THỐNG TRÍ ĐỨC TECH ONLINE TRÊN CỔNG: ${PORT}`);
});