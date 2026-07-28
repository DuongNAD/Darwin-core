# DARWIN LAB — Chọn lọc tự nhiên

Phòng thí nghiệm mô phỏng chọn lọc tự nhiên chạy trong trình duyệt. Không ai
chọn "con tốt nhất"; chỉ có năng lượng, thức ăn và cái chết. Gene nào còn sót
lại sau nhiều ngày chính là câu trả lời của môi trường.

Công cụ được thiết kế để **phát biểu được điều gì đó có căn cứ**: cùng một hạt
giống cho cùng một kết quả, một lần chạy không được coi là bằng chứng, và mọi
chỉ số đều mang đúng tên của thứ nó đo.

## Chạy thử

```bash
npm install
```

```bash
npm run dev
```

Bản mô phỏng là một tệp HTML tự chứa tại `public/darwin-lab.html` — mở trực tiếp
bằng trình duyệt cũng chạy được, không cần máy chủ. Trang Next (`app/page.tsx`)
chỉ nhúng tệp đó trong một iframe.

## Bảy gene và cái giá của chúng

Không gene nào chỉ toàn lợi. Mỗi gene phải trả giá ở đâu đó, nếu không nó sẽ
leo tới trần rồi ngừng tiến hoá.

| Gene | Lợi | Giá |
|---|---|---|
| Tốc độ | tới thức ăn trước đối thủ | chi phí tăng theo bình phương tốc độ |
| Kích thước | ăn được cá thể nhỏ hơn ≥50% | cơ thể lớn đốt năng lượng liên tục |
| Cảm nhận | thấy thức ăn từ xa, và tìm được bạn tình | tốn năng lượng duy trì giác quan |
| Trao đổi chất | phần vận động rẻ đi | phần duy trì đắt lên, và tuổi thọ ngắn lại |
| Miễn dịch | giảm chết vì dịch và độc tố | tốn năng lượng duy trì |
| Ngụy trang | khó bị phát hiện khi có kẻ săn mồi | tốn năng lượng duy trì |
| Sinh sản | đẻ sớm hơn, ngưỡng thấp hơn | con non yếu hơn |

Riêng trao đổi chất có **điểm tối ưu nằm giữa dải** chứ không ở mép:
`m* = √(work / (LOAD × maintenance))`. Vì m* phụ thuộc chính bộ gene của từng cá
thể, mỗi môi trường chọn một chiến lược khác nhau — kịch bản dồi dào chọn trao
đổi chất tiết kiệm, kịch bản khan hiếm chọn đốt nhanh.

## Tám kịch bản

`baseline` · `scarcity` · `abundance` · `predator` · `climate` · `epidemic` ·
`islands` · `extinction`

Mỗi kịch bản khai báo một giả thuyết. Giả thuyết là thứ để **kiểm chứng**, không
phải thứ để tin — xem phần hạn chế đã biết bên dưới.

## Làm nghiên cứu, không chỉ xem cho vui

**Hạt giống tái lập được.** Sân mô phỏng có kích thước logic cố định
(`SIM_WIDTH × SIM_HEIGHT`); renderer co giãn hình ảnh chứ không co giãn thế
giới. Đổi kích thước cửa sổ không đổi kết quả.

**Đối chứng A/B.** Hai quần thể, cùng hạt giống, khác kịch bản. Trong chế độ
này tham số môi trường bị khoá và độ tương phản A/B được hiện thẳng ra, để
chênh lệch chỉ đến từ kịch bản.

**Nghiên cứu lặp lại.** Chạy N bản lặp với các hạt giống khác nhau, báo cáo
trung bình ± khoảng tin cậy 95% (phân phối t, không phải z). Ở chế độ đối chứng,
chênh lệch B−A được kiểm định Welch — khoảng tin cậy không chứa 0 mới là bằng
chứng. Engine chạy trong Web Worker dựng từ chính thẻ `<script id="simCore">`,
nên không tồn tại bản sao engine thứ hai có thể trôi lệch.

**Chỉ số mang đúng tên.**

- *Số con trọn đời* — số con trung bình của những cá thể đã sống hết đời.
- *Chênh lệch chọn lọc* — đồng nhất thức Robertson–Price `S = Cov(w, z)/w̄`, đo
  trên trọn một ngày. Đây là chọn lọc **qua sinh sản**; nó không bao gồm chọn
  lọc qua sống sót, nên có thể ngược chiều với thay đổi thực tế.
- *Dòng dõi hiệu dụng* — nghịch đảo chỉ số Simpson trên dòng dõi. Đây **không**
  phải kích thước quần thể hiệu dụng Ne của di truyền quần thể.
- *Phân hoá Q_ST* — `σ²giữa / (σ²giữa + 2σ²trong)` giữa các tiểu quần thể bị
  cách ly. Gọi là F_ST sẽ sai: F_ST được định nghĩa trên tần số allele, thứ mô
  hình này không có. Chỉ số này để trống ở kịch bản không có rào cách ly.

**Sinh sản hữu tính.** Bật lên, mỗi gene được rút độc lập từ một trong hai cha
mẹ (phân ly tự do của bảy locus không liên kết) rồi mới đột biến — con có thể
mang tốc độ của cha và cảm nhận của mẹ. Cha mẹ phải tìm được nhau trong bán
kính cảm nhận, nên quần thể thưa tự sinh ra hiệu ứng Allee.

**Xuất dữ liệu.** JSON (kèm kết quả lặp lại nếu có) và CSV 15 cột với cả bảy
gene theo từng ngày.

## Hạn chế đã biết

- **Kịch bản `islands` không tách nhánh.** Q_ST đo được chỉ 0.03 ± 0.05 sau 20
  ngày × 4 bản lặp — khoảng tin cậy chứa 0. Lý do: hai đảo có môi trường giống
  hệt nhau nên chọn lọc như nhau ở hai bên, chỉ còn trôi dạt di truyền, mà trôi
  dạt quá yếu ở quy mô quần thể này. Muốn thấy phân nhánh thật thì phải cho hai
  đảo môi trường khác nhau.
- **Giả thuyết của `scarcity` chưa được ủng hộ** ở 5 bản lặp × 20 ngày: tốc độ,
  cảm nhận và trao đổi chất đều có khoảng tin cậy chứa 0. Hiệu ứng có thể xuất
  hiện ở thời lượng dài hơn — đó chính là lý do khoảng tin cậy tồn tại.
- **Vòng chạy trực tiếp ở luồng chính** (worker chỉ gánh phần lặp lại). Đo trong
  trình duyệt cho thấy điều này ổn: ngay ở trần quần thể 460 kèm sinh sản hữu
  tính, một nhịp tốn 0.614 ms, nên 4x chỉ cần ~15% một lõi và 4 nhịp mỗi khung
  hình — bộ chặn 28 nhịp không chạm tới. Giao diện vẫn hiện nhịp thật bên cạnh
  nút tốc độ để phòng máy yếu hoặc tab bị đẩy xuống nền.
- Tính trạng là số thực liên tục, không phải allele. Mọi phát biểu về di truyền
  quần thể ở đây là phát biểu về **tính trạng số lượng**.

## Cấu trúc

```
public/darwin-lab.html   toàn bộ mô phỏng — nguồn sự thật duy nhất
  <script id="simCore">  engine: World, Creature, thống kê, xuất dữ liệu
  <script>               renderer + giao diện + bộ chạy lặp lại
app/                     vỏ Next: metadata và iframe
tests/                   engine, giao diện, và test hồi quy tính toàn vẹn
```

Engine nằm giữa hai mốc `// ===== SIM CORE START/END =====`. Test nạp lại đúng
đoạn đó bằng `node:vm`, còn Web Worker nạp lại đúng thẻ script đó — cả ba nơi
dùng chung một mã nguồn.

## Lệnh

- `npm run dev` — chạy máy chủ phát triển
- `npm run build` — dựng bản phát hành
- `npm test` — dựng rồi chạy toàn bộ test
- `npm run lint` — kiểm tra mã nguồn

## Test

`tests/research-integrity.test.mjs` là các test hồi quy: mỗi test ghim một lỗi
đã từng làm số liệu của phòng thí nghiệm không đáng tin — thiên lệch theo chỉ số
mảng, hạt giống không tái lập, chỉ số bị gán sai tên, khoảng tin cậy dùng sai
phân phối. Từng test đã được kiểm chứng ngược: cài lại lỗi cũ vào engine thì
đúng test tương ứng fail.

## Triển khai

Chạy trên [vinext](https://github.com/cloudflare/vinext) + Cloudflare Workers.
`.openai/hosting.json` khai báo binding D1/R2 tuỳ chọn; `db/schema.ts` để trống
vì mô phỏng không cần cơ sở dữ liệu.
