# test-roboticvn.ps1 — Test tay full flow API roboticvn
# Chay:  .\test-roboticvn.ps1
# Doi variant/so luong:  .\test-roboticvn.ps1 -VariantId "variant_xxx" -Quantity 1
# LUU Y: dat don THANH CONG se TRU TIEN that trong vi.

param(
  [string]$Key       = "apk_7766f346-0c20-49a1-86df-01405291bf9e",
  [string]$VariantId = "variant_01KV4G6K7N2GDCFJQY5MRD7V28",  # Canva slot edu 5000d (re nhat con hang)
  [int]   $Quantity  = 1,
  [string]$Currency  = "vnd"
)

$B = "https://api.roboticvn.com/api/v2"
$H = @{ "x-api-key" = $Key }

# Helper: goi API, in HTTP code + body ke ca khi loi (Invoke-RestMethod mac dinh nem loi khi >=400)
function Invoke-RV {
  param([string]$Method, [string]$Path, $Body)
  $url = "$B$Path"
  try {
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 6 -Compress
      return Invoke-RestMethod -Method $Method -Uri $url -Headers $H -ContentType "application/json" -Body $json
    }
    return Invoke-RestMethod -Method $Method -Uri $url -Headers $H
  } catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { "no-response" }
    $text = ""
    if ($resp) { $text = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
    Write-Host "  [HTTP $code] $text" -ForegroundColor Red
    return $null
  }
}

Write-Host "===== 1. So du vi =====" -ForegroundColor Cyan
$bal = Invoke-RV GET "/wallet/balance"
if ($bal) { $bal.data }

Write-Host "`n===== 2. Dat don ($VariantId x$Quantity $Currency, payment_method=wallet) =====" -ForegroundColor Cyan
$checkout = Invoke-RV POST "/orders" @{ items = @(@{ variant_id = $VariantId; quantity = $Quantity }); currency_code = $Currency; payment_method = "wallet" }
if (-not $checkout) {
  Write-Host "=> Dat don THAT BAI. Dung lai." -ForegroundColor Yellow
  return
}
Write-Host "  checkout:" ($checkout.data | ConvertTo-Json -Compress) -ForegroundColor Green
$oid = $checkout.data.order_id   # API tra thang order_id trong response tao don
Write-Host "  order_id = $oid"

Write-Host "`n===== 3. Poll trang thai don (status=completed la xong; KHONG dung payment-status vi tra-tu-vi luon bao not_paid) =====" -ForegroundColor Cyan
for ($i = 1; $i -le 10; $i++) {
  $od = (Invoke-RV GET "/orders/$oid").data
  Write-Host "  lan $i -> status=$($od.status) payment_status=$($od.payment_status) total=$($od.total)"
  if ($od.status -eq "completed") { break }
  Start-Sleep -Seconds 3
}

Write-Host "`n===== 5. Lay account giao hang =====" -ForegroundColor Cyan
$del = (Invoke-RV GET "/orders/$oid/delivery").data
if ($del -and $del.Count -gt 0) {
  $del | Format-List item_id, display_title, account, password, additional_info
} else {
  Write-Host "  delivery rong (chua giao / dang xu ly)." -ForegroundColor Yellow
}

Write-Host "`n===== 6. So du sau khi mua =====" -ForegroundColor Cyan
(Invoke-RV GET "/wallet/balance").data
