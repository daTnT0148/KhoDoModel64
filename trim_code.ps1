$all = Get-Content 'D:\KhoDoModel64\Code.gs' -Encoding UTF8
$trimmed = $all[0..598]
$trimmed | Set-Content 'D:\KhoDoModel64\Code.gs' -Encoding UTF8
Write-Host ("Done. Lines: " + $trimmed.Count)
