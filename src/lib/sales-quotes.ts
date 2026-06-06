/**
 * 100 câu nói truyền động lực cho sales — chia 5 nhóm chủ đề.
 * Mỗi ngày hiển thị 1 câu trên homepage; cycle qua 100 câu trước khi
 * lặp lại. Same quote cho mọi user trong cùng 1 ngày (theo UTC date).
 *
 * Thứ tự "random" interleaved bằng multiplicative permutation
 * (daysSinceEpoch * 37) mod 100 — 37 coprime với 100 nên đi đủ 100 vị
 * trí trong 100 ngày trước khi lặp.
 */

export type QuoteCategory =
  | "tu-duy"
  | "kien-tri"
  | "thau-hieu"
  | "hanh-dong"
  | "chot-sale"

export interface SalesQuote {
  index: number
  text: string
  category: QuoteCategory
}

export const QUOTE_CATEGORY_LABEL: Record<QuoteCategory, string> = {
  "tu-duy": "Tư duy & Thái độ",
  "kien-tri": "Kiên trì & Vượt qua từ chối",
  "thau-hieu": "Thấu hiểu KH & Tạo giá trị",
  "hanh-dong": "Hành động & Kỷ luật",
  "chot-sale": "Chốt sale & Đột phá",
}

/** 100 câu, theo đúng thứ tự nhóm gốc (1-100). */
export const SALES_QUOTES: SalesQuote[] = [
  // Nhóm 1 — Tư duy & Thái độ (1-20)
  { index: 1, category: "tu-duy", text: "Bán hàng không phải là bán sản phẩm, mà là bán giải pháp." },
  { index: 2, category: "tu-duy", text: "Thái độ của bạn quyết định cao độ của bạn trong nghề sales." },
  { index: 3, category: "tu-duy", text: "Đừng tìm khách hàng cho sản phẩm của bạn, hãy tìm sản phẩm cho khách hàng của bạn." },
  { index: 4, category: "tu-duy", text: "Không có ranh giới giới hạn nào cho những gì bạn có thể đạt được, ngoại trừ giới hạn trong chính tâm trí bạn." },
  { index: 5, category: "tu-duy", text: "Thành công trong sales bắt đầu từ việc bạn thực sự tin vào những gì mình đang bán." },
  { index: 6, category: "tu-duy", text: "Người bán hàng xuất sắc không sinh ra, họ được rèn luyện." },
  { index: 7, category: "tu-duy", text: "Bạn không được trả tiền cho những giờ làm việc, bạn được trả tiền cho giá trị bạn tạo ra trong những giờ đó." },
  { index: 8, category: "tu-duy", text: "Năng lượng bạn tỏa ra là thứ khách hàng mua trước khi họ rút ví mua sản phẩm." },
  { index: 9, category: "tu-duy", text: "Sự sợ hãi là một tín hiệu cho thấy bạn đang tiến rất gần đến sự đột phá." },
  { index: 10, category: "tu-duy", text: "Bán hàng là một nghệ thuật, và bạn chính là nghệ sĩ làm chủ bàn đàm phán." },
  { index: 11, category: "tu-duy", text: "Khách hàng mua bằng cảm xúc và biện minh bằng logic." },
  { index: 12, category: "tu-duy", text: "Hãy làm việc chăm chỉ trong im lặng, để thành công và doanh số của bạn lên tiếng." },
  { index: 13, category: "tu-duy", text: "Đừng bán thứ bạn muốn bán, hãy bán thứ khách hàng cần mua." },
  { index: 14, category: "tu-duy", text: "Người bán hàng nói giỏi có thể chốt một đơn, nhưng người bán hàng biết lắng nghe sẽ chốt được một đời." },
  { index: 15, category: "tu-duy", text: "Cách tốt nhất để dự đoán tương lai là tự mình vạch ra kế hoạch và tạo ra nó." },
  { index: 16, category: "tu-duy", text: "Bạn chính là CEO của cuộc đời và sự nghiệp kinh doanh của riêng mình." },
  { index: 17, category: "tu-duy", text: "Sự tự tin là chiếc chìa khóa đầu tiên mở ra mọi cánh cửa thành công." },
  { index: 18, category: "tu-duy", text: "Mỗi ngày mới là một cơ hội mới để bạn phá vỡ kỷ lục của chính mình ngày hôm qua." },
  { index: 19, category: "tu-duy", text: "Đừng sợ thất bại, hãy sợ việc dậm chân tại chỗ trong vùng an toàn." },
  { index: 20, category: "tu-duy", text: "Người chiến thắng không bao giờ bỏ cuộc, người bỏ cuộc không bao giờ chiến thắng." },

  // Nhóm 2 — Kiên trì & Vượt qua sự từ chối (21-40)
  { index: 21, category: "kien-tri", text: "Mỗi lời \"Không\" chỉ đơn giản là một bước đệm đưa bạn đến gần hơn với một lời \"Có\"." },
  { index: 22, category: "kien-tri", text: "Sự từ chối không phải là thất bại, đó là phản hồi để bạn mài giũa lại kịch bản." },
  { index: 23, category: "kien-tri", text: "Nước chảy đá mòn không phải nhờ sức mạnh, mà nhờ sự bền bỉ không ngừng nghỉ." },
  { index: 24, category: "kien-tri", text: "Nếu con đường bán hàng quá dễ dàng, ai trên đời này cũng đã trở thành triệu phú." },
  { index: 25, category: "kien-tri", text: "Khi khách hàng nói \"Không\", đó là lúc cuộc đàm phán và bán hàng thực sự bắt đầu." },
  { index: 26, category: "kien-tri", text: "Khó khăn không phải là rào cản, mà là bài kiểm tra để lọc ra những người xuất chúng nhất." },
  { index: 27, category: "kien-tri", text: "Hãy ăn mừng những lời từ chối, vì nó chứng tỏ bạn đang thực sự xông pha làm việc." },
  { index: 28, category: "kien-tri", text: "Không có khách hàng lạnh lùng, chỉ có người bán hàng chưa đủ nhiệt huyết để làm ấm họ." },
  { index: 29, category: "kien-tri", text: "Bí quyết lớn nhất của thành công là kiên trì theo đuổi mục tiêu đến cùng, bất chấp gió ngược." },
  { index: 30, category: "kien-tri", text: "Dù hôm nay có tồi tệ thế nào, ngày mai trời vẫn sáng và data khách hàng vẫn chờ bạn xử lý." },
  { index: 31, category: "kien-tri", text: "Sự kiên trì vĩ đại hơn và mang lại nhiều tiền hơn bất kỳ kỹ năng khéo léo nào." },
  { index: 32, category: "kien-tri", text: "Đừng bỏ cuộc ở cuộc gọi thứ 9, khi cuộc gọi thứ 10 có thể chính là hợp đồng lớn nhất tháng." },
  { index: 33, category: "kien-tri", text: "Lời từ chối hôm nay có thể là cái gật đầu của ngày mai. Hãy kiên nhẫn nuôi dưỡng mối quan hệ." },
  { index: 34, category: "kien-tri", text: "Thành công vang dội là kết quả của hàng ngàn nỗ lực nhỏ bé mà không ai nhìn thấy." },
  { index: 35, category: "kien-tri", text: "Ngã bảy lần, đứng dậy tám lần. Hãy luôn là người trụ lại cuối cùng." },
  { index: 36, category: "kien-tri", text: "Bạn không thể kiểm soát phản ứng của khách hàng, nhưng bạn hoàn toàn kiểm soát được nỗ lực của chính mình." },
  { index: 37, category: "kien-tri", text: "Đừng để một ngày tồi tệ khiến bạn nghĩ rằng mình có một sự nghiệp tồi tệ." },
  { index: 38, category: "kien-tri", text: "Lời phàn nàn của khách hàng chính là cơ hội tuyệt vời nhất để bạn thể hiện năng lực xử lý vấn đề." },
  { index: 39, category: "kien-tri", text: "Khách hàng khó tính nhất chính là người thầy vĩ đại nhất của bạn trong nghề." },
  { index: 40, category: "kien-tri", text: "Hãy làm quen với sự từ chối, nó rèn luyện cho bạn một lớp áo giáp vững chắc và một trái tim kiên cường." },

  // Nhóm 3 — Thấu hiểu khách hàng & Tạo giá trị (41-60)
  { index: 41, category: "thau-hieu", text: "Hãy đối xử với mọi khách hàng như thể họ là vị khách quý nhất trong nhà bạn." },
  { index: 42, category: "thau-hieu", text: "Bán hàng là giúp đỡ. Bán hàng là phục vụ. Bán hàng là trao đi giá trị." },
  { index: 43, category: "thau-hieu", text: "Giá trị bạn trao đi càng lớn, doanh thu và vị thế bạn nhận lại càng cao." },
  { index: 44, category: "thau-hieu", text: "Đừng chỉ cố gắng chốt một đơn hàng, hãy nỗ lực tạo ra một người hâm mộ thương hiệu." },
  { index: 45, category: "thau-hieu", text: "Khách hàng không quan tâm bạn biết bao nhiêu, cho đến khi họ biết bạn quan tâm đến họ mức nào." },
  { index: 46, category: "thau-hieu", text: "Một mối quan hệ vững chắc sinh lời gấp ngàn lần một thương vụ chớp nhoáng." },
  { index: 47, category: "thau-hieu", text: "Bán hàng kết thúc khi khách hàng hài lòng, không phải khi bạn nhận được tiền hoa hồng." },
  { index: 48, category: "thau-hieu", text: "Hãy ngừng cố gắng bán hàng, hãy bắt đầu giúp khách hàng mua được giải pháp tốt nhất." },
  { index: 49, category: "thau-hieu", text: "Sự tín nhiệm từ khách hàng là tài sản vô giá và bền vững nhất của mọi nhân viên sales." },
  { index: 50, category: "thau-hieu", text: "Đặt ra những câu hỏi sắc bén quan trọng hơn việc thao thao bất tuyệt bằng những câu nói hay." },
  { index: 51, category: "thau-hieu", text: "Khách hàng có thể quên những gì bạn nói, nhưng họ không bao giờ quên cảm giác mà bạn mang lại cho họ." },
  { index: 52, category: "thau-hieu", text: "Sự khác biệt giữa một sản phẩm bình thường và một giải pháp tuyệt vời nằm ở chính người bán nó." },
  { index: 53, category: "thau-hieu", text: "Bạn không bán tính năng sản phẩm, bạn bán một viễn cảnh tương lai tốt đẹp hơn cho khách hàng." },
  { index: 54, category: "thau-hieu", text: "Khâu dịch vụ sau bán hàng mới là lúc đẳng cấp của một người sales thực sự lên tiếng." },
  { index: 55, category: "thau-hieu", text: "Sự chân thành và trung thực là kỹ năng chốt sale mạnh mẽ, khó sao chép nhất." },
  { index: 56, category: "thau-hieu", text: "Hãy trở thành chuyên gia sâu sắc trong lĩnh vực của bạn, khách hàng sẽ tự động tìm đến xin lời khuyên." },
  { index: 57, category: "thau-hieu", text: "Nếu bạn thực sự giải quyết được nỗi đau của khách hàng, việc chốt đơn chỉ là thủ tục hành chính." },
  { index: 58, category: "thau-hieu", text: "Đừng nói với khách hàng bạn tuyệt vời thế nào, hãy chứng minh điều đó qua kết quả thực tế." },
  { index: 59, category: "thau-hieu", text: "Người bán hàng xuất chúng nhìn thấy cơ hội cung cấp dịch vụ trong mọi lời ca thán." },
  { index: 60, category: "thau-hieu", text: "Hãy bán giá trị, đừng bao giờ hạ mình chỉ để bán giá cả." },

  // Nhóm 4 — Hành động, Kỷ luật & Thực thi (61-80)
  { index: 61, category: "hanh-dong", text: "Động lực giúp bạn bắt đầu, nhưng kỷ luật sắt đá mới là thứ mang lại kết quả cuối tháng." },
  { index: 62, category: "hanh-dong", text: "Một kế hoạch vĩ đại mà thiếu đi hành động thì mãi mãi chỉ là một giấc mơ." },
  { index: 63, category: "hanh-dong", text: "Những gì bạn hành động hôm nay sẽ định hình bảng lương của bạn vào tháng sau." },
  { index: 64, category: "hanh-dong", text: "Hãy bắt đầu sớm hơn một chút, làm việc chăm chỉ hơn một chút và ra về muộn hơn một chút." },
  { index: 65, category: "hanh-dong", text: "Mục tiêu không viết ra giấy chỉ là một lời ước suông." },
  { index: 66, category: "hanh-dong", text: "Cuộc gọi lạnh (cold call) không bao giờ lạnh nếu nhiệt huyết của bạn đủ nóng." },
  { index: 67, category: "hanh-dong", text: "Hoàn thành tốt hơn hoàn hảo. Đừng chờ đợi sự chuẩn bị tuyệt đối, hãy nhấc máy lên và gọi." },
  { index: 68, category: "hanh-dong", text: "Không có cái gọi là \"may mắn\" ngẫu nhiên trong sales, chỉ có sự chuẩn bị kỹ lưỡng gặp đúng cơ hội." },
  { index: 69, category: "hanh-dong", text: "Hành động dứt khoát sẽ xóa tan mọi sự nghi ngờ. Khi lo sợ, hãy lao vào công việc với cường độ cao nhất." },
  { index: 70, category: "hanh-dong", text: "Hãy là người chủ động săn tìm cơ hội thay vì ngồi há miệng chờ sung rụng." },
  { index: 71, category: "hanh-dong", text: "Thời gian của người làm sales rất đắt giá, đừng lãng phí nó vào những việc không sinh ra tiền." },
  { index: 72, category: "hanh-dong", text: "Làm chủ dữ liệu khách hàng là làm chủ cả một cuộc chơi lớn." },
  { index: 73, category: "hanh-dong", text: "Theo sát (follow-up) liên tục chính là mỏ vàng mà phần lớn nhân viên sales hay bỏ quên." },
  { index: 74, category: "hanh-dong", text: "Không có gì từ trên trời rơi xuống ngoại trừ những hạt mưa. Hãy xách balo lên và đi gặp đối tác." },
  { index: 75, category: "hanh-dong", text: "Thói quen nhỏ tạo nên thành quả lớn. Hãy giữ kỷ luật với KPI từng ngày." },
  { index: 76, category: "hanh-dong", text: "Hãy chuẩn bị cho mọi cuộc gặp như thể đó là thương vụ định đoạt cả sự nghiệp của bạn." },
  { index: 77, category: "hanh-dong", text: "Hiệu suất chốt sale tỷ lệ thuận tuyệt đối với số lượng người bạn dám chủ động tiếp cận." },
  { index: 78, category: "hanh-dong", text: "Đừng đợi đến ngày cuối tháng mới chạy nước rút, hãy đua với chính mình ngay từ ngày mùng 1." },
  { index: 79, category: "hanh-dong", text: "Sự kiên định trong việc tạo ra tệp khách hàng tiềm năng là chìa khóa của một phễu bán hàng khổng lồ." },
  { index: 80, category: "hanh-dong", text: "Hãy đo lường mọi con số, vì những gì có thể đo lường được thì đều có thể nhân bản và tối ưu được." },

  // Nhóm 5 — Chốt sale & Đột phá doanh thu (81-100)
  { index: 81, category: "chot-sale", text: "Chốt sale không phải là dấu chấm hết, nó là viên gạch đầu tiên xây dựng một mối quan hệ đối tác dài hạn." },
  { index: 82, category: "chot-sale", text: "Sự chần chừ của khách hàng không phải là từ chối, đó là tín hiệu cho thấy họ cần bạn cung cấp thêm niềm tin." },
  { index: 83, category: "chot-sale", text: "Luôn luôn chốt (Always Be Closing) — Không phải là ép uổng, mà là dẫn dắt khách hàng ra quyết định đúng đắn." },
  { index: 84, category: "chot-sale", text: "Nếu bạn không dũng cảm đề nghị mua hàng, câu trả lời mặc định sẽ luôn luôn là \"Không\"." },
  { index: 85, category: "chot-sale", text: "Người nắm giữ năng lượng và niềm tin cao hơn sẽ là người kiểm soát bàn đàm phán chốt sale." },
  { index: 86, category: "chot-sale", text: "Đừng bán hàng bằng tư thế van xin, hãy bán hàng bằng sự tự hào về giải pháp của bạn." },
  { index: 87, category: "chot-sale", text: "Lý do lớn nhất khiến hàng ngàn thương vụ thất bại là vì người sales quên mất việc \"yêu cầu khách hàng xuống tiền\"." },
  { index: 88, category: "chot-sale", text: "Chốt sale thực chất là một quá trình tâm lý giúp khách hàng vượt qua rào cản sợ hãi của chính họ." },
  { index: 89, category: "chot-sale", text: "Đừng sợ việc báo một cái giá cao, hãy sợ việc bạn không cung cấp đủ giá trị tương xứng với cái giá đó." },
  { index: 90, category: "chot-sale", text: "Sự im lặng ngay sau khi đưa ra đề nghị chốt sale là vàng. Hãy lên tiếng đề nghị, rồi kiên nhẫn chờ đợi." },
  { index: 91, category: "chot-sale", text: "Hãy tập trung bán hàng cho những người có tiền và có thẩm quyền quyết định, đừng lãng phí thời gian sai đối tượng." },
  { index: 92, category: "chot-sale", text: "Lợi thế cạnh tranh lớn nhất không nằm ở tính năng sản phẩm, mà nằm ở tốc độ phục vụ của cá nhân bạn." },
  { index: 93, category: "chot-sale", text: "Một thương vụ đỉnh cao là khi ký hợp đồng xong, cả người mua và người bán đều cảm thấy mình có lợi." },
  { index: 94, category: "chot-sale", text: "Chốt sale bằng sự chân thành, minh bạch sẽ đem lại cho bạn không chỉ lợi nhuận mà còn là một danh tiếng lẫy lừng." },
  { index: 95, category: "chot-sale", text: "Hãy để kết quả bạn mang lại cho khách hàng vượt xa những lời hứa hẹn ban đầu." },
  { index: 96, category: "chot-sale", text: "Dù là bán B2B hay B2C, cốt lõi cuối cùng vẫn luôn là H2H — Con người kết nối với Con người." },
  { index: 97, category: "chot-sale", text: "Giới hạn duy nhất của mức doanh thu bạn đạt được chính là giới hạn trong tầm nhìn chiến lược của bạn." },
  { index: 98, category: "chot-sale", text: "Đỉnh cao của nghệ thuật sales là khiến khách hàng hiện tại tự động mang khách hàng mới đến cho bạn." },
  { index: 99, category: "chot-sale", text: "Hãy biến sự thành công và phát triển của khách hàng thành niềm đam mê lớn nhất của chính bạn." },
  { index: 100, category: "chot-sale", text: "Đừng chỉ định vị mình là một nhân viên sales, hãy vươn lên trở thành một cố vấn chiến lược không thể thiếu của khách hàng." },
]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Lấy câu nói cho ngày `date` (mặc định = hôm nay).
 * Same date → same quote cho mọi user. Cycle qua 100 câu trong 100 ngày
 * trước khi lặp; thứ tự interleaved bằng multiplicative permutation
 * (× 37 mod 100) để các chủ đề xen kẽ nhau, không bị 20 ngày liền cùng
 * nhóm.
 */
export function getDailyQuote(date: Date = new Date()): SalesQuote {
  const utcMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  )
  const daysSinceEpoch = Math.floor(utcMidnight / DAY_MS)
  // 37 coprime với 100 → cycle đủ 100 vị trí trước khi lặp.
  const permuted = (daysSinceEpoch * 37) % SALES_QUOTES.length
  return SALES_QUOTES[permuted]
}
