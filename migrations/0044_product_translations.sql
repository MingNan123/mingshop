ALTER TABLE products ADD COLUMN translations_json TEXT;

-- Initial storefront translations. Merchants can refine or replace every value
-- from Admin → Products; new products simply fall back to Simplified Chinese.
UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','域名註冊與解析設定｜需求確認訂金','description','20 美元需求確認訂金。下單後確認域名後綴、可用性、註冊年限與 DNS 解析需求，再提供最終報價。'),
  'en', json_object('name','Domain Registration & DNS Setup | Consultation Deposit','description','A $20 consultation deposit. After purchase, we confirm the domain extension, availability, registration term, and DNS requirements before providing a final quote.'),
  'ko', json_object('name','도메인 등록 및 DNS 설정 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 주문 후 도메인 확장자, 사용 가능 여부, 등록 기간 및 DNS 요구사항을 확인하고 최종 견적을 안내합니다.'),
  'ja', json_object('name','ドメイン登録・DNS設定｜要件確認デポジット','description','20米ドルの要件確認デポジットです。ご注文後、ドメイン拡張子、空き状況、登録期間、DNS要件を確認し、最終見積もりをご案内します。')
) WHERE slug = 'domain-registration-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','雲端伺服器部署與維運｜需求確認訂金','description','20 美元需求確認訂金。下單後確認配置、地區、流量、雲端服務商與部署內容，再提供最終報價。'),
  'en', json_object('name','Cloud Server Deployment & Operations | Consultation Deposit','description','A $20 consultation deposit. We confirm configuration, region, traffic, cloud provider, and deployment scope before providing a final quote.'),
  'ko', json_object('name','클라우드 서버 배포 및 운영 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 구성, 지역, 트래픽, 클라우드 공급자 및 배포 범위를 확인한 후 최종 견적을 안내합니다.'),
  'ja', json_object('name','クラウドサーバー導入・運用｜要件確認デポジット','description','20米ドルの要件確認デポジットです。構成、地域、通信量、クラウド事業者、導入範囲を確認後、最終見積もりをご案内します。')
) WHERE slug = 'cloud-server-deployment-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','AI 應用客製開發｜需求確認訂金','description','20 美元需求確認訂金。下單後確認功能範圍、模型、資料來源、交付週期與最終報價。'),
  'en', json_object('name','Custom AI Application Development | Consultation Deposit','description','A $20 consultation deposit. We confirm features, model choice, data sources, delivery schedule, and the final development quote.'),
  'ko', json_object('name','AI 애플리케이션 맞춤 개발 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 기능 범위, 모델, 데이터 소스, 납기 및 최종 개발 견적을 확인합니다.'),
  'ja', json_object('name','AIアプリケーション受託開発｜要件確認デポジット','description','20米ドルの要件確認デポジットです。機能範囲、モデル、データソース、納期、最終開発費を確認します。')
) WHERE slug = 'ai-application-development-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','零售商城系統客製開發｜需求確認訂金','description','20 美元需求確認訂金。下單後確認商品類型、支付方式、會員功能、物流需求與最終報價。'),
  'en', json_object('name','Custom Retail Store Development | Consultation Deposit','description','A $20 consultation deposit. We confirm product types, payments, membership features, logistics, and the final development quote.'),
  'ko', json_object('name','리테일 쇼핑몰 맞춤 개발 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 상품 유형, 결제, 회원 기능, 물류 요구사항 및 최종 견적을 확인합니다.'),
  'ja', json_object('name','小売ECシステム受託開発｜要件確認デポジット','description','20米ドルの要件確認デポジットです。商品種別、決済、会員機能、物流要件、最終見積もりを確認します。')
) WHERE slug = 'retail-store-development-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','線上點餐系統客製開發｜需求確認訂金','description','20 美元需求確認訂金。下單後確認門市數量、點餐方式、支付與列印設備需求，再提供最終報價。'),
  'en', json_object('name','Custom Online Ordering System | Consultation Deposit','description','A $20 consultation deposit. We confirm store count, ordering flow, payment, and printing requirements before providing a final quote.'),
  'ko', json_object('name','온라인 주문 시스템 맞춤 개발 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 매장 수, 주문 방식, 결제 및 인쇄 장비 요구사항을 확인하고 최종 견적을 안내합니다.'),
  'ja', json_object('name','オンライン注文システム受託開発｜要件確認デポジット','description','20米ドルの要件確認デポジットです。店舗数、注文方法、決済、印刷機器の要件を確認し、最終見積もりをご案内します。')
) WHERE slug = 'online-ordering-development-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','會員行銷系統客製開發｜需求確認訂金','description','20 美元需求確認訂金。下單後確認會員規則、點數制度、行銷管道與最終報價。'),
  'en', json_object('name','Custom Membership Marketing System | Consultation Deposit','description','A $20 consultation deposit. We confirm membership rules, points, marketing channels, and the final development quote.'),
  'ko', json_object('name','회원 마케팅 시스템 맞춤 개발 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 회원 규칙, 포인트 제도, 마케팅 채널 및 최종 견적을 확인합니다.'),
  'ja', json_object('name','会員マーケティングシステム受託開発｜要件確認デポジット','description','20米ドルの要件確認デポジットです。会員ルール、ポイント制度、マーケティング経路、最終見積もりを確認します。')
) WHERE slug = 'membership-marketing-development-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','OA 辦公與預約系統開發｜需求確認訂金','description','20 美元需求確認訂金。下單後確認組織架構、審批流程、預約規則與最終報價。'),
  'en', json_object('name','OA Office & Booking System Development | Consultation Deposit','description','A $20 consultation deposit. We confirm organization structure, approval workflows, booking rules, and the final development quote.'),
  'ko', json_object('name','OA 업무 및 예약 시스템 개발 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 조직 구조, 승인 절차, 예약 규칙 및 최종 견적을 확인합니다.'),
  'ja', json_object('name','OA業務・予約システム開発｜要件確認デポジット','description','20米ドルの要件確認デポジットです。組織構成、承認フロー、予約ルール、最終見積もりを確認します。')
) WHERE slug = 'oa-appointment-development-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','地域服務平台客製開發｜需求確認訂金','description','20 美元需求確認訂金。下單後確認服務類型、營運地區、人員管理、支付與地圖需求，再提供最終報價。'),
  'en', json_object('name','Custom Local Services Platform | Consultation Deposit','description','A $20 consultation deposit. We confirm service types, operating region, staff management, payments, and map requirements before quoting.'),
  'ko', json_object('name','지역 서비스 플랫폼 맞춤 개발 | 상담 예약금','description','20달러 요구사항 확인 예약금입니다. 서비스 유형, 운영 지역, 인력 관리, 결제 및 지도 요구사항을 확인합니다.'),
  'ja', json_object('name','地域サービスプラットフォーム受託開発｜要件確認デポジット','description','20米ドルの要件確認デポジットです。サービス種別、運営地域、人員管理、決済、地図要件を確認し、最終見積もりをご案内します。')
) WHERE slug = 'local-services-platform-deposit';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','程式碼撰寫協助','description','提供 Python、Java、C、C++ 與 SQL 程式碼撰寫、註解、說明和文件整理服務。本商品為一次性數位服務。'),
  'en', json_object('name','Code Writing Assistance','description','Python, Java, C, C++, and SQL coding assistance with comments, explanations, and documentation. This is a one-time digital service.'),
  'ko', json_object('name','코드 작성 지원','description','Python, Java, C, C++ 및 SQL 코드 작성, 주석, 설명과 문서 정리를 지원하는 일회성 디지털 서비스입니다.'),
  'ja', json_object('name','コード作成サポート','description','Python、Java、C、C++、SQLのコード作成、コメント、解説、ドキュメント整理を行う単発のデジタルサービスです。')
) WHERE slug = 'code-writing-help';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','ChatGPT Plus 升級服務','description','下單後請留意電子郵件。透過官方管道處理，通常於 1 至 5 分鐘內完成升級。'),
  'en', json_object('name','ChatGPT Plus Upgrade Service','description','Check your email after purchase. The upgrade is handled through official channels and is usually completed within 1–5 minutes.'),
  'ko', json_object('name','ChatGPT Plus 업그레이드 서비스','description','주문 후 이메일을 확인해 주세요. 공식 채널을 통해 처리되며 일반적으로 1~5분 내에 업그레이드됩니다.'),
  'ja', json_object('name','ChatGPT Plus アップグレードサービス','description','ご注文後はメールをご確認ください。公式ルートで処理し、通常1〜5分以内にアップグレードが完了します。')
) WHERE slug = 'api-documentation';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','地址文件翻譯服務','description','提供指定平台的地址文件翻譯服務。下單時請提供姓名、地區和可接收郵件的信箱。'),
  'en', json_object('name','Address Document Translation Service','description','Address-document translation for supported platforms. Please provide your name, region, and a working email address when ordering.'),
  'ko', json_object('name','주소 문서 번역 서비스','description','지원 플랫폼의 주소 문서 번역 서비스입니다. 주문 시 이름, 지역 및 수신 가능한 이메일 주소를 입력해 주세요.'),
  'ja', json_object('name','住所書類翻訳サービス','description','対応プラットフォーム向けの住所書類翻訳サービスです。ご注文時に氏名、地域、受信可能なメールアドレスをご入力ください。')
) WHERE slug = 'brand-brief';

UPDATE products SET translations_json = json_object(
  'zh-Hant', json_object('name','ERP 系統','description','整合供應鏈、採購、銷售、庫存、財務與人力資源流程的一體化企業管理平台。'),
  'en', json_object('name','ERP System','description','An integrated enterprise platform covering supply chain, purchasing, sales, inventory, finance, human resources, and operational analytics.'),
  'ko', json_object('name','ERP 시스템','description','공급망, 구매, 판매, 재고, 재무, 인사 및 운영 분석을 통합하는 기업 관리 플랫폼입니다.'),
  'ja', json_object('name','ERPシステム','description','サプライチェーン、調達、販売、在庫、財務、人事、業務分析を統合する企業管理プラットフォームです。')
) WHERE slug = 'erp';

-- Keep the deposit/balance conditions visible in every translated description.
UPDATE products SET translations_json = json_set(translations_json,
  '$."zh-Hant".description', json_extract(translations_json, '$."zh-Hant".description') || char(10) || char(10) || '此為需求確認訂金，非完整服務費。方案與最終報價確認後，需另付剩餘費用，收到餘款後才開始服務。訂金可抵扣最終服務費，第三方平台與資源費用另計。',
  '$.en.description', json_extract(translations_json, '$.en.description') || char(10) || char(10) || 'This is a consultation deposit, not the full service price. After the scope and final quote are agreed, the remaining balance must be paid before work begins. The deposit is credited toward the final service fee. Third-party platform and resource fees are additional.',
  '$.ko.description', json_extract(translations_json, '$.ko.description') || char(10) || char(10) || '본 금액은 상담 예약금이며 전체 서비스 요금이 아닙니다. 범위와 최종 견적에 동의한 후 잔금을 결제해야 작업이 시작됩니다. 예약금은 최종 서비스 요금에서 차감되며 외부 플랫폼 및 리소스 비용은 별도입니다.',
  '$.ja.description', json_extract(translations_json, '$.ja.description') || char(10) || char(10) || 'これは要件確認のデポジットで、サービス全体の料金ではありません。範囲と最終見積もりの合意後、残金の入金を確認してから作業を開始します。デポジットは最終料金に充当されます。外部サービスやリソースの費用は別途必要です。'
) WHERE slug IN ('domain-registration-deposit', 'cloud-server-deployment-deposit', 'ai-application-development-deposit', 'retail-store-development-deposit', 'online-ordering-development-deposit', 'membership-marketing-development-deposit', 'oa-appointment-development-deposit', 'local-services-platform-deposit');
