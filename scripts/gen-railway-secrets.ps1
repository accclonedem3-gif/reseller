# Generate the cryptographic secrets needed for Railway deployment.
# Run once, copy the output, paste into Railway dashboard Variables tab.
# Each value is a 32-byte random hex string (64 chars) — strong for JWT/encryption.

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
}

@"
# Paste these into Railway -> service -> Variables:

JWT_ACCESS_SECRET=$(New-Secret)
JWT_REFRESH_SECRET=$(New-Secret)
APP_ENCRYPTION_KEY=$(New-Secret)
INTERNAL_API_TOKEN=$(New-Secret)

# Important: same APP_ENCRYPTION_KEY and INTERNAL_API_TOKEN must be set on BOTH
# the api and worker services. Save these somewhere -- losing APP_ENCRYPTION_KEY
# means existing encrypted DB data becomes unrecoverable.
"@
