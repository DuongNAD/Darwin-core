# darwin-lab-mcp-server

Cổng MCP cho Darwin Lab. Cho phép một agent chạy và lái thí nghiệm chọn lọc tự
nhiên: đọc vốn gene, tiêm cá thể, gây thắt cổ chai, đổi tham số môi trường, chạy
tiếp từng ngày.

Server **đọc engine trực tiếp từ `public/darwin-lab.html`** lúc khởi động, đúng
đoạn mã mà trình duyệt chạy. Không có bản engine thứ hai để trôi lệch.

## Chạy

```bash
node mcp/server.mjs
```

Server nói giao thức MCP qua stdio. Mọi thông tin cho người đọc đi ra stderr,
stdout dành riêng cho giao thức.

## Cấu hình cho Claude Code

```bash
claude mcp add darwin-lab -- node E:/Project/Darwin-core/mcp/server.mjs
```

Hoặc thêm tay vào cấu hình MCP của client:

```json
{
  "mcpServers": {
    "darwin-lab": {
      "command": "node",
      "args": ["E:/Project/Darwin-core/mcp/server.mjs"]
    }
  }
}
```

## Công cụ

Chỉ đọc:

| Tool | Việc |
|---|---|
| `darwin_get_state` | ngày, kịch bản, ba bậc dinh dưỡng, các chỉ số di truyền |
| `darwin_get_gene_pool` | trung bình / độ lệch / min / max của bảy gene, theo từng loài |
| `darwin_list_creatures` | từng cá thể, có phân trang |
| `darwin_get_history` | số liệu theo ngày |
| `darwin_get_interventions` | nhật ký can thiệp |

Có tác động:

| Tool | Việc |
|---|---|
| `darwin_advance_days` | chạy tiếp — cách duy nhất để thời gian trôi |
| `darwin_inject_creatures` | thả cá thể mang gene chỉ định, loài ăn cỏ hoặc ăn thịt |
| `darwin_set_gene` | đặt thẳng một gene cho một phần quần thể |
| `darwin_nudge_gene` | cộng thêm một lượng, giữ nguyên biến dị |
| `darwin_cull` | giết ngẫu nhiên một phần quần thể |
| `darwin_set_parameter` | đổi tham số môi trường |
| `darwin_add_plants` | gieo thêm hạt |
| `darwin_new_experiment` | bắt đầu lại với kịch bản / hạt giống / chế độ sinh sản |

Mọi tool đều nhận `response_format`: `markdown` (mặc định, để đọc) hoặc `json`.

## Điều cần biết trước khi rút kết luận

**Mọi thao tác có tác động đều được ghi lại.** Nó vào nhật ký can thiệp của thế
giới, vào nhật ký sự kiện, và đi theo dữ liệu xuất ra. `darwin_get_state` báo số
can thiệp đã có. Một bản chạy bị nhúng tay vào không bao giờ trông giống một bản
chạy sạch — hãy gọi `darwin_get_interventions` trước khi tin vào một kết quả.

**Một lần chạy không chứng minh được gì.** Quần thể dao động mạnh giữa các hạt
giống: `scarcity` có hệ số biến thiên 20%, hệ săn mồi–con mồi sụp hẳn ở khoảng
1/12 hạt giống. Muốn phát biểu về một kịch bản thì chạy `darwin_new_experiment`
với nhiều hạt giống khác nhau rồi so phân bố, hoặc dùng thẻ nghiên cứu lặp lại
trong trang web.

**Cùng hạt giống cho cùng kết quả.** `darwin_new_experiment` với cùng
`scenario` + `seed` + `sexual` luôn tái lập chính xác một bản chạy — miễn là
không có can thiệp nào ở giữa.

**Mọi chỉ số di truyền tính trên loài ăn cỏ.** Loài ăn thịt là loài riêng, chịu
chọn lọc ngược lại; gộp chung vào một trung bình sẽ làm hỏng mọi con số. Dùng
`darwin_get_gene_pool` với `species='carnivore'` để xem chúng.

## Phụ thuộc

`@modelcontextprotocol/sdk` và `zod` nằm ở `devDependencies`: trang web triển
khai không dùng tới chúng, chỉ server này cần. Nếu cài bằng `--production` thì
server sẽ không chạy được.

## Test

```bash
node --test tests/mcp-server.test.mjs
```

Test dựng server thật, nói JSON-RPC qua stdio như một client, và kiểm tra kết
quả trả về — không chạm vào nội bộ server. Chính nó đã bắt được hai lỗi nối dây
mà test đơn vị bỏ sót.
