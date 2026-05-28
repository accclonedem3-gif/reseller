# Test Web2m webhook endpoint
# Run after deploy. Replace TOKEN + ORDER_CODE with real values.

param(
    [Parameter(Mandatory=$true)] [string]$Server,         # e.g. https://altivoxai.com
    [Parameter(Mandatory=$true)] [string]$AccessToken,    # Access Token đã lưu trong dashboard Pay2m
    [Parameter(Mandatory=$true)] [string]$OrderCode,      # externalOrderCode của 1 đơn PENDING (có thể tự tạo bằng cách bấm Mua trên bot)
    [int]$Amount = 10000
)

$Url = "$Server/api/v1/webhooks/web2m"

# Format payload exactly như Web2m docs
$Body = @{
    status = $true
    data = @(
        @{
            id = "test-$(Get-Date -UFormat %s)"
            type = "IN"
            transactionID = "TEST123"
            amount = "$Amount"
            description = "TEST CK $OrderCode"
            date = (Get-Date -Format "dd/MM/yyyy")
            bank = "MBB"
        }
    )
} | ConvertTo-Json -Depth 5

Write-Host ">>> POST $Url" -ForegroundColor Cyan
Write-Host "Bearer: $($AccessToken.Substring(0, [Math]::Min(10, $AccessToken.Length)))..." -ForegroundColor Gray
Write-Host "Body: $Body" -ForegroundColor Gray
Write-Host ""

$Headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $AccessToken"
}

try {
    $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $Body
    Write-Host ">>> Response:" -ForegroundColor Green
    $Response | ConvertTo-Json
} catch {
    Write-Host ">>> Error:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message
    }
}

Write-Host ""
Write-Host "Sau khi nhan {`"status`":true,`"msg`":`"Ok`"}:" -ForegroundColor Yellow
Write-Host "1. Vao DB check don $OrderCode -> payment_status phai = PAID"
Write-Host "2. Vao bot Telegram check khach co duoc giao hang khong"
