#!/usr/bin/env bash
set -euo pipefail

# Clean-room Worker + D1 gate. Everything lives in an isolated Miniflare state
# directory, so neither a developer's normal local DB nor production is touched.
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/minshop-d1-integration.XXXXXX")"
worker_log="$state_dir/worker.log"
worker_pid=""
test_port="${D1_TEST_PORT:-8791}"

cleanup() {
  if [[ -n "$worker_pid" ]] && kill -0 "$worker_pid" 2>/dev/null; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  rm -rf "$state_dir"
}
trap cleanup EXIT INT TERM

npx wrangler d1 migrations apply DB --local --persist-to "$state_dir" >/dev/null
npx wrangler d1 execute DB --local --persist-to "$state_dir" --file ./seed.sql >/dev/null

# Runtime fixtures: setup complete, enough rows to prove search pagination, one
# category, and two merchant-approved stablecoin networks. The RPC URLs are never
# contacted by this gate; payment settlement has its own watcher tests. Checkout
# only needs a valid enabled profile so availability/network locking is real.
stablecoin_profiles='[{"id":"usdt-test","token":"usdt","label":"USDT Test EVM","kind":"evm","enabled":true,"receiveAddress":"0x1111111111111111111111111111111111111111","endpoint":"https://rpc.invalid.example","tokenAddress":"0x2222222222222222222222222222222222222222","decimals":6,"confirmations":1},{"id":"usdc-test","token":"usdc","label":"USDC Test EVM","kind":"evm","enabled":true,"receiveAddress":"0x3333333333333333333333333333333333333333","endpoint":"https://rpc.invalid.example","tokenAddress":"0x4444444444444444444444444444444444444444","decimals":6,"confirmations":1}]'
npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "INSERT INTO settings (key, value) VALUES ('setup_complete', '1'), ('payment_provider', 'usdt'), ('stablecoin_networks_json', '$stablecoin_profiles');" >/dev/null
npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 30) INSERT INTO products (name, slug, description, price_cents, stock) SELECT 'Pagination Item ' || n, 'pagination-item-' || n, 'pagination fixture', 1000 + n, 10 FROM seq;" >/dev/null
npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "INSERT INTO categories (name, slug) VALUES ('Apparel', 'apparel'); INSERT INTO product_categories (product_id, category_id) SELECT p.id, c.id FROM products p, categories c WHERE p.slug = 'sample-tee' AND c.slug = 'apparel'; UPDATE products SET public_id = 'prod_' || lower(substr(hex(randomblob(10)),1,10)) WHERE public_id IS NULL; UPDATE categories SET public_id = 'cat_' || lower(substr(hex(randomblob(10)),1,10)) WHERE public_id IS NULL;" >/dev/null

# Give physical stablecoin checkout a deterministic flat-rate destination. This
# exercises the in-app address/rate path for both stablecoins instead of relying
# on the retired demo checkout.
shipping_config='{"schema":2,"revision":1,"enabled":true,"packageWeightGrams":0,"zones":[{"name":"Worldwide","countries":["*"],"rates":[{"label":"Standard","pricing":{"type":"flat","amountCents":500}}],"freeOverCents":null}]}'
npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "INSERT INTO settings (key, value) VALUES ('shipping_config', '$shipping_config');" >/dev/null

image_bucket="$(node -e '
  const config = require("node:fs").readFileSync("wrangler.jsonc", "utf8");
  const m = config.match(/"binding"\s*:\s*"BUCKET"[\s\S]*?"bucket_name"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error("BUCKET binding is missing a bucket_name");
  process.stdout.write(m[1]);
')"
files_bucket="$(node -e '
  const config = require("node:fs").readFileSync("wrangler.jsonc", "utf8");
  const m = config.match(/"binding"\s*:\s*"FILES"[\s\S]*?"bucket_name"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error("FILES binding is missing a bucket_name");
  process.stdout.write(m[1]);
')"
npx wrangler r2 object put "$image_bucket/media/cache-header-fixture.svg" \
  --local --persist-to "$state_dir" --file public/favicon.svg --content-type image/svg+xml >/dev/null
npx wrangler r2 object put "$files_bucket/deliverables/integration/guide.txt" \
  --local --persist-to "$state_dir" --file README.md --content-type text/plain \
  --cache-control 'private, no-store' >/dev/null
npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "UPDATE products SET file_key = 'deliverables/integration/guide.txt', file_name = 'integration-guide.txt', file_mime = 'text/plain', file_size_bytes = 1 WHERE slug = 'sample-tee';" >/dev/null

index_rows="$(npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_orders_created','idx_orders_email_created','idx_products_active_created') ORDER BY name;")"
for index_name in idx_orders_created idx_orders_email_created idx_products_active_created; do
  [[ "$index_rows" == *"$index_name"* ]] || { echo "D1 integration failed: missing query index $index_name" >&2; exit 1; }
done

# Boot the actual production build against the isolated bindings.
export X_LOCAL_OBSERVABILITY=false
npx wrangler dev \
  --config dist/server/wrangler.json \
  --persist-to "$state_dir" \
  --var CANONICAL_ORIGIN:https://canonical.example \
  --var AUTH_SECRET:integration-auth-secret \
  --ip 127.0.0.1 --port "$test_port" >"$worker_log" 2>&1 &
worker_pid="$!"

catalog=""
for _ in {1..40}; do
  if catalog="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port/api/products?limit=1" 2>/dev/null)"; then break; fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then sed -n '1,180p' "$worker_log" >&2; exit 1; fi
  sleep 0.25
done
if [[ -z "$catalog" ]]; then
  tail -n 120 "$worker_log" >&2
  echo "D1 integration failed: Worker did not become ready" >&2
  exit 1
fi

node -e '
  const b=JSON.parse(process.argv[1]);
  if (!Number.isInteger(b.total)||b.total<1) throw new Error("seeded product total missing");
  if (!Array.isArray(b.products)||b.products.length!==1) throw new Error("catalog did not read D1");
  if (!b.products[0].slug||!Number.isInteger(b.products[0].price?.cents)) throw new Error("catalog shape invalid");
  if (!b.products[0].url?.startsWith("https://canonical.example/products/")) throw new Error("canonical product URL missing");
' "$catalog"

search_page="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port/api/products?q=pagination&limit=10&offset=10")"
node -e '
  const b=JSON.parse(process.argv[1]);
  if (b.total!==30||b.limit!==10||b.offset!==10||b.products?.length!==10) throw new Error("search pagination is wrong");
' "$search_page"

sample_page="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port/api/products?q=sample&limit=2")"
node -e '
  const b=JSON.parse(process.argv[1]); const p=b.products.find(x=>x.slug==="sample-tee");
  if (!p||!p.categories.includes("Apparel")) throw new Error("catalog category missing");
' "$sample_page"
sample_id="$(node -e 'const b=JSON.parse(process.argv[1]); const p=b.products.find(x=>x.slug==="sample-tee"); if(!p?.id)process.exit(1); process.stdout.write(String(p.id))' "$sample_page")"

# Media/page tables and the product-image backfill are part of a clean install.
media_rows="$(npx wrangler d1 execute DB --local --persist-to "$state_dir" --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('media','pages','page_media') ORDER BY name;")"
for table in media page_media pages; do [[ "$media_rows" == *"$table"* ]] || { echo "D1 integration failed: missing table $table" >&2; exit 1; }; done
backfill="$(npx wrangler d1 execute DB --local --persist-to "$state_dir" --command "SELECT COUNT(*) AS missing FROM (SELECT image_key FROM product_images UNION SELECT image_key FROM products WHERE image_key IS NOT NULL AND image_key != '') refs LEFT JOIN media m ON m.image_key=refs.image_key WHERE m.id IS NULL;")"
[[ "$backfill" == *"0"* ]] || { echo "D1 integration failed: product image keys missing from media" >&2; exit 1; }

# Retired singular catalog URLs remain permanent redirects.
for pair in "product/sample-tee:/products/sample-tee" "category/apparel:/categories/apparel"; do
  old_path="${pair%%:*}"; expected="${pair##*:}"
  redirect="$(curl --max-time 30 --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' "http://127.0.0.1:$test_port/$old_path?sort=price")"
  [[ "$redirect" == "301 http://127.0.0.1:$test_port$expected?sort=price" ]] || { echo "D1 integration failed: /$old_path redirect was $redirect" >&2; exit 1; }
done

npx wrangler d1 execute DB --local --persist-to "$state_dir" \
  --command "INSERT INTO pages (title, slug, body_markdown, published) VALUES ('Shipping Info','shipping','## Shipping\n\nWe ship worldwide.',1),('Secret Draft','secret-draft','Not ready.',0); UPDATE pages SET public_id='page_' || lower(substr(hex(randomblob(10)),1,10)) WHERE public_id IS NULL; INSERT INTO menu_items (location,target_type,target_id,position) SELECT 'footer','page',id,0 FROM pages WHERE slug='shipping'; UPDATE menu_items SET public_id='nav_' || lower(substr(hex(randomblob(10)),1,10)) WHERE public_id IS NULL;" >/dev/null
page_body="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port/pages/shipping")"
[[ "$page_body" == *"We ship worldwide."* ]] || { echo "D1 integration failed: published page did not render" >&2; exit 1; }

# Cache assertions. Wrangler's local proxy can very rarely return its own exact
# 500 body "Error: Network connection lost." while the Worker stays healthy.
# Retry ONLY that infrastructure signature (or a curl transport failure); every
# other completed HTTP response is judged immediately so a real 500 cannot hide.
assert_cache_control() {
  local path="$1" expected="$2" method="${3:-GET}"
  local headers="$state_dir/cache-headers.txt" body="$state_dir/cache-body.txt"
  local status="" rc=0 attempt transient=0
  for attempt in 1 2 3; do
    : >"$headers"; : >"$body"
    if [[ "$method" == "HEAD" ]]; then
      status="$(curl --max-time 30 --silent --head --output /dev/null --dump-header "$headers" --write-out '%{http_code}' "http://127.0.0.1:$test_port$path")" && rc=0 || rc=$?
    else
      status="$(curl --max-time 30 --silent --output "$body" --dump-header "$headers" --write-out '%{http_code}' "http://127.0.0.1:$test_port$path")" && rc=0 || rc=$?
    fi
    transient=0
    if [[ "$rc" != 0 ]]; then
      transient=1
    elif [[ "$method" != "HEAD" && "$status" == "500" ]] && grep -Fxq 'Error: Network connection lost.' "$body"; then
      transient=1
    fi
    [[ "$transient" == 0 ]] && break
    if (( attempt < 3 )); then echo "  (retrying $method $path after local Wrangler transport loss)" >&2; sleep 1; fi
  done
  if [[ "$transient" != 0 ]]; then
    echo "D1 integration failed: $method $path had no Worker response after 3 attempts" >&2
    tail -n 80 "$worker_log" >&2
    exit 1
  fi
  local actual
  actual="$(tr -d '\r' <"$headers" | awk 'tolower($0) ~ /^cache-control:/ {sub(/^[^:]+:[[:space:]]*/,""); print; exit}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "D1 integration failed: $method $path cache-control '$actual' != '$expected' (HTTP $status)" >&2
    tr -d '\r' <"$headers" >&2; head -c 500 "$body" >&2; echo >&2; tail -n 80 "$worker_log" >&2
    exit 1
  fi
}

public_cache='public, max-age=0, s-maxage=600'
private_cache='private, no-store'
for path in / /products /products/sample-tee /categories/apparel '/search?q=sample' /pages/shipping /robots.txt /sitemap.xml /llms.txt /api/products /api/products/sample-tee; do assert_cache_control "$path" "$public_cache"; done
assert_cache_control / "$public_cache" HEAD
for path in /cart /checkout /express /payment-setup /partials/cart-count /account /account/login /order/not-a-token /order/not-a-token/status /pay/not-an-id /admin /api/admin/products /api/internal/cache-purge /api/cart /api/checkout; do assert_cache_control "$path" "$private_cache"; done
assert_cache_control /product/sample-tee "$public_cache"
assert_cache_control /category/apparel "$public_cache"
assert_cache_control /images/media/cache-header-fixture.svg 'public, max-age=31536000, immutable'
assert_cache_control /pages/no-such-page 'no-store'
assert_cache_control /not-a-route "$private_cache"

assert_cache_tag() {
  local path="$1" expected="$2" headers="$state_dir/cache-tag-headers.txt"
  curl --max-time 30 --silent --output /dev/null --dump-header "$headers" "http://127.0.0.1:$test_port$path"
  local actual; actual="$(tr -d '\r' <"$headers" | awk 'tolower($0) ~ /^cache-tag:/ {sub(/^[^:]+:[[:space:]]*/,""); print; exit}')"
  [[ "$actual" == "$expected" ]] || { echo "D1 integration failed: GET $path cache-tag '$actual' != '$expected'" >&2; exit 1; }
}
assert_cache_tag /pages/shipping 'catalog,shell'
assert_cache_tag /robots.txt 'catalog,shell'
assert_cache_tag /cart ''
assert_cache_tag /not-a-route ''

# Published pages are discoverable; drafts are neither public nor cached.
draft_headers="$(curl --max-time 30 --silent --include --output /dev/null --write-out '%{http_code}' --dump-header - "http://127.0.0.1:$test_port/pages/secret-draft")"
[[ "$draft_headers" == *"404"* && "$draft_headers" == *"no-store"* ]] || { echo "D1 integration failed: draft page visibility/cache policy is wrong" >&2; exit 1; }
for surface in sitemap.xml llms.txt; do
  body="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port/$surface")"
  [[ "$body" == *"/pages/shipping"* && "$body" != *"secret-draft"* && "$body" == *"https://canonical.example/"* ]] || { echo "D1 integration failed: $surface page discovery is wrong" >&2; exit 1; }
done
robots="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port/robots.txt")"
[[ "$robots" == *"Sitemap: https://canonical.example/sitemap.xml"* ]] || { echo "D1 integration failed: robots canonical sitemap missing" >&2; exit 1; }

# Cart state remains private while the shared storefront shell stays cacheable.
cookie_jar="$state_dir/cart-cookies.txt"
cart_status="$(curl --max-time 30 --silent --output /dev/null --write-out '%{http_code}' --cookie-jar "$cookie_jar" -H 'content-type: application/x-www-form-urlencoded' -H "origin: http://127.0.0.1:$test_port" -H 'x-partial: 1' --data "_action=add&product_id=$sample_id" "http://127.0.0.1:$test_port/api/cart")"
[[ "$cart_status" == "204" ]] || { echo "D1 integration failed: add-to-cart HTTP $cart_status" >&2; exit 1; }
cart_count_json="$(curl --max-time 30 --fail --silent --show-error --cookie "$cookie_jar" "http://127.0.0.1:$test_port/partials/cart-count")"
node -e 'const b=JSON.parse(process.argv[1]); if(b.count!==1) throw new Error(`expected cart count 1, got ${b.count}`)' "$cart_count_json"

# ── Stablecoin checkout contract ────────────────────────────────────────────
# New sales accept only USDC/USDT. A physical USDT order must collect ship_to,
# price shipping on the server, hold inventory, then lock exactly one merchant-
# approved network on the capability payment page.
stock_before="$(npx wrangler d1 execute DB --local --persist-to "$state_dir" --json --command "SELECT stock FROM products WHERE slug='sample-tee';" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[0].results[0].stock)))')"
checkout_body="$state_dir/usdt-checkout.json"
checkout_status="$(curl --max-time 30 --silent --output "$checkout_body" --write-out '%{http_code}' -H 'content-type: application/json' -H "origin: http://127.0.0.1:$test_port" --data '{"items":[{"slug":"sample-tee","quantity":1}],"method":"usdt","ship_to":{"email":"integration@example.com","name":"Integration Test","line1":"1 Test St","city":"Testville","postal":"12345","country":"US"}}' "http://127.0.0.1:$test_port/api/checkout")"
if [[ "$checkout_status" != "200" ]]; then echo "D1 integration failed: USDT checkout HTTP $checkout_status: $(cat "$checkout_body")" >&2; exit 1; fi
checkout="$(cat "$checkout_body")"
node -e '
  const b=JSON.parse(process.argv[1]);
  if(b.method!=="usdt") throw new Error("USDT method not preserved");
  if(!b.checkout_url?.includes("/pay/otk_")) throw new Error("capability checkout URL missing");
  if(!b.order_status_url?.includes("/order/otk_")) throw new Error("status URL missing");
  if(b.shipping_cents!==500||b.total_cents!==b.subtotal_cents+500) throw new Error("server shipping total wrong");
  if(!b.available_methods?.includes("usdt")||!b.available_methods?.includes("usdc")) throw new Error("stablecoin availability wrong");
' "$checkout"
pay_path="$(node -e 'const b=JSON.parse(process.argv[1]);process.stdout.write(new URL(b.checkout_url).pathname)' "$checkout")"
order_id="$(node -e 'const b=JSON.parse(process.argv[1]);process.stdout.write(b.order_public_id)' "$checkout")"
status_path="$(node -e 'const b=JSON.parse(process.argv[1]);process.stdout.write(new URL(b.order_status_url).pathname)' "$checkout")"

stock_after="$(npx wrangler d1 execute DB --local --persist-to "$state_dir" --json --command "SELECT stock FROM products WHERE slug='sample-tee';" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[0].results[0].stock)))')"
[[ "$stock_after" -eq $((stock_before - 1)) ]] || { echo "D1 integration failed: USDT checkout did not reserve one unit" >&2; exit 1; }

confirming="$(curl --max-time 30 --fail --silent --show-error -H 'Accept:' "http://127.0.0.1:$test_port$status_path")"
node -e 'const b=JSON.parse(process.argv[1]); if(b.status!=="confirming") throw new Error(`expected confirming, got ${b.status}`)' "$confirming"

pay_page="$(curl --max-time 30 --fail --silent --show-error "http://127.0.0.1:$test_port$pay_path")"
[[ "$pay_page" == *"USDT Test EVM"* ]] || { echo "D1 integration failed: merchant USDT network was not offered" >&2; exit 1; }
lock_page="$state_dir/usdt-lock.html"
lock_status="$(curl --max-time 30 --silent --output "$lock_page" --write-out '%{http_code}' -H 'content-type: application/x-www-form-urlencoded' -H "origin: http://127.0.0.1:$test_port" --data 'network_id=usdt-test&email=integration%40example.com' "http://127.0.0.1:$test_port$pay_path")"
[[ "$lock_status" == "200" ]] || { echo "D1 integration failed: USDT network lock HTTP $lock_status" >&2; exit 1; }
[[ "$(cat "$lock_page")" == *"0x1111111111111111111111111111111111111111"* ]] || { echo "D1 integration failed: locked receive address was not rendered" >&2; exit 1; }

snapshot="$(npx wrangler d1 execute DB --local --persist-to "$state_dir" --json --command "SELECT backend,status,stablecoin_network_id,stablecoin_network_snapshot,stablecoin_network_selected_at,email FROM pending_payments WHERE public_id='$order_id';")"
node -e '
  const row=JSON.parse(process.argv[1])[0].results[0];
  if(row.backend!=="usdt"||row.status!=="pending") throw new Error("pending USDT row is wrong");
  if(row.stablecoin_network_id!=="usdt-test"||!row.stablecoin_network_selected_at) throw new Error("network was not locked");
  const p=JSON.parse(row.stablecoin_network_snapshot); if(p.id!=="usdt-test"||p.receiveAddress!=="0x1111111111111111111111111111111111111111") throw new Error("network snapshot drifted");
  if(row.email!=="integration@example.com") throw new Error("checkout email missing");
' "$snapshot"

# Once locked, posting another enabled network cannot switch the order.
switch_body="$state_dir/usdt-switch.html"
switch_status="$(curl --max-time 30 --silent --output "$switch_body" --write-out '%{http_code}' -H 'content-type: application/x-www-form-urlencoded' --data 'network_id=usdc-test&email=other%40example.com' "http://127.0.0.1:$test_port$pay_path")"
[[ "$switch_status" == "200" && "$(cat "$switch_body")" == *"已经锁定"* ]] || { echo "D1 integration failed: locked stablecoin network could be changed" >&2; exit 1; }

# A physical stablecoin order without ship_to is rejected before stock is held.
no_ship_body="$state_dir/no-ship.json"
no_ship_status="$(curl --max-time 30 --silent --output "$no_ship_body" --write-out '%{http_code}' -H 'content-type: application/json' -H "origin: http://127.0.0.1:$test_port" --data '{"items":[{"slug":"sample-tee","quantity":1}],"method":"usdc"}' "http://127.0.0.1:$test_port/api/checkout")"
[[ "$no_ship_status" == "400" ]] || { echo "D1 integration failed: physical USDC without ship_to HTTP $no_ship_status" >&2; exit 1; }

# Retired rails are not merely hidden in UI; the JSON boundary rejects them.
for retired in demo stripe alipay wechatpay lightning opennode; do
  retired_body="$state_dir/retired-$retired.json"
  retired_status="$(curl --max-time 30 --silent --output "$retired_body" --write-out '%{http_code}' -H 'content-type: application/json' -H "origin: http://127.0.0.1:$test_port" --data "{\"items\":[{\"slug\":\"sample-tee\",\"quantity\":1}],\"method\":\"$retired\"}" "http://127.0.0.1:$test_port/api/checkout")"
  [[ "$retired_status" == "400" ]] || { echo "D1 integration failed: retired method $retired returned HTTP $retired_status" >&2; exit 1; }
done

# The built Worker must expose the scheduled handler used for stablecoin sweeps
# and reservation cleanup. With store_url unset this probes the handler without
# contacting the deliberately-invalid fixture RPC endpoint.
scheduled_status="$(curl --max-time 30 --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$test_port/cdn-cgi/handler/scheduled")"
[[ "$scheduled_status" == "200" ]] || { echo "D1 integration failed: built worker exposes no scheduled handler (got $scheduled_status)" >&2; exit 1; }

echo "D1 integration passed: clean migrations + catalog/cache + USDC/USDT checkout/network locking + cron handler"
