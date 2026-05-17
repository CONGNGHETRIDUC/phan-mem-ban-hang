const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000; // Render sẽ tự cấp cổng phù hợp khi lên mạng

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình đường dẫn thông minh: Chạy trên Render lưu vào ổ đĩa vĩnh viễn /data, chạy ở máy nhà lưu vào thư mục data của dự án
const thuMucData = process.env.RENDER ? '/data' : path.join(__dirname, 'data');
const fileSanPham = path.join(thuMucData, 'products.csv');
const fileDonHang = path.join(thuMucData, 'orders.csv');

// Tự động kiểm tra và tạo thư mục cùng file orders.csv chuẩn mã UTF-8 nếu chưa có sẵn
if (!fs.existsSync(thuMucData)) {
    fs.mkdirSync(thuMucData, { recursive: true });
}
if (!fs.existsSync(fileDonHang)) {
    const tieuDeMacDinh = "maDon,thoiGian,tenKhach,sdtKhach,tenSP,soLuong,doanhThu,loiNhuan\n";
    fs.writeFileSync(fileDonHang, tieuDeMacDinh, 'utf8');
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== HÀM ĐỌC/GHI FILE CSV AN TOÀN TUYỆT ĐỐI ====================

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

function ghiThemVaoLichSu(duongDanFile, doiTuongDonHang) {
    const dongMoi = Object.values(doiTuongDonHang).join(',') + '\n';
    fs.appendFileSync(duongDanFile, dongMoi, 'utf8');
}

// ==================== CÁC API XỬ LÝ DỮ LIỆU ĐỒNG BỘ ====================

app.get('/api/san-pham', (req, res) => {
    res.json(docFileCSV(fileSanPham));
});

app.get('/api/lich-su-don-hang', (req, res) => {
    res.json(docFileCSV(fileDonHang));
});

app.post('/api/don-hang', (req, res) => {
    const { skuMua, soLuongMua, tenKhachHang, sdtKhachHang } = req.body;
    let khoHang = docFileCSV(fileSanPham);
    let danhSachDonCu = docFileCSV(fileDonHang);

    let sanPham = khoHang.find(item => item.SKU === skuMua);
    if (!sanPham) {
        return res.status(444).json({ error: "Không tìm thấy mã sản phẩm này!" });
    }

    if (sanPham.Ton_Kho < soLuongMua) {
        return res.status(400).json({ error: `Kho không đủ! Hiện chỉ còn ${sanPham.Ton_Kho} sản phẩm.` });
    }

    const doanhThuDon = sanPham.Gia_Ban * soLuongMua;
    const chiPhiVon = sanPham.Gia_Nhap * soLuongMua;
    const loiNhuanDon = doanhThuDon - chiPhiVon;

    sanPham.Ton_Kho -= Number(soLuongMua);
    ghiFileCSV(fileSanPham, khoHang);

    const maDonMoi = "HD" + String(danhSachDonCu.length + 1).padStart(3, '0');
    
    const bayGio = new Date();
    const thoiGian = `${bayGio.getDate()}/${bayGio.getMonth()+1}/${bayGio.getFullYear()} ${bayGio.getHours()}:${String(bayGio.getMinutes()).padStart(2, '0')}`;
    const tenKhachSach = (tenKhachHang || "Khách vãng lai").replace(/,/g, ' ');

    const thongTinDonHang = {
        maDon: maDonMoi,
        thoiGian: thoiGian,
        tenKhach: tenKhachSach,
        sdtKhach: sdtKhachHang || "---",
        tenSP: sanPham.Ten_San_Pham,
        soLuong: soLuongMua,
        doanhThu: doanhThuDon,
        loiNhuan: loiNhuanDon
    };

    ghiThemVaoLichSu(fileDonHang, thongTinDonHang);

    let updateDonHang = docFileCSV(fileDonHang);
    let tongDoanhThu = 0;
    let tongLoiNhuan = 0;
    updateDonHang.forEach(don => {
        if (don) {
            tongDoanhThu += Number(don.doanhThu || 0);
            tongLoiNhuan += Number(don.loiNhuan || 0);
        }
    });

    res.json({ 
        message: "Chốt đơn thành công!", 
        donHang: thongTinDonHang,
        tongQuanHienTai: {
            soDonHang: updateDonHang.length,
            doanhThu: tongDoanhThu,
            loiNhuan: tongLoiNhuan
        }
    });
});

app.post('/api/nhap-kho', (req, res) => {
    const { SKU, Ten_San_Pham, Danh_Muc, Gia_Nhap, Gia_Ban, Ton_Kho, Toi_Thieu } = req.body;
    let khoHang = docFileCSV(fileSanPham);
    let sanPhamCoSan = khoHang.find(item => item.SKU === SKU);

    if (sanPhamCoSan) {
        sanPhamCoSan.Ton_Kho += Number(Ton_Kho);
        sanPhamCoSan.Gia_Nhap = Number(Gia_Nhap);
        sanPhamCoSan.Gia_Ban = Number(Gia_Ban);
        ghiFileCSV(fileSanPham, khoHang);
        return res.json({ message: `Mã hàng ${SKU} đã tồn tại. Hệ thống đã cộng dồn thành công!` });
    }

    const sanPhamMoi = { SKU, Ten_San_Pham, Danh_Muc, Gia_Nhap, Gia_Ban, Ton_Kho, Toi_Thieu };
    khoHang.push(sanPhamMoi);
    ghiFileCSV(fileSanPham, khoHang);
    res.json({ message: `Đã thêm mới thành công sản phẩm hàng hóa mã ${SKU}!` });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HỆ THỐNG TRÍ ĐỨC TECH ĐANG ONLINE TRÊN CỔNG: ${PORT}`);
});