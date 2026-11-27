param([string]$Sha = 'efacb74')
# Waits until every workflow run for this commit (and the downloads sync that
# follows them) has finished, then prints each one's result.
$full = (git rev-parse $Sha).Trim()
$deadline = (Get-Date).AddMinutes(75)
$expected = @('CI', 'Native Windows', 'Mobile packages', 'Desktop & Roku packages', 'Interface update feed', 'Sync TVM Downloads')
while ((Get-Date) -lt $deadline) {
    $runs = gh run list --repo GL-327/TVM --limit 40 --json databaseId,name,headSha,status,conclusion,createdAt | ConvertFrom-Json
    $mine = $runs | Where-Object { $_.headSha -eq $full }
    $latest = foreach ($name in ($mine.name | Sort-Object -Unique)) { $mine | Where-Object name -eq $name | Sort-Object createdAt -Descending | Select-Object -First 1 }
    $open = @($latest | Where-Object status -ne 'completed')
    $syncDone = @($latest | Where-Object { $_.name -eq 'Sync TVM Downloads' -and $_.status -eq 'completed' }).Count -gt 0
    $buildsSeen = @($latest | Where-Object { $_.name -in @('CI', 'Native Windows', 'Mobile packages', 'Desktop & Roku packages', 'Interface update feed') }).Count
    if ($open.Count -eq 0 -and $buildsSeen -ge 5 -and $syncDone) {
        $latest | Sort-Object name | ForEach-Object { "$($_.conclusion): $($_.name) ($($_.databaseId))" }
        'ALL BUILDS DONE'
        exit 0
    }
    Start-Sleep -Seconds 60
}
'timed out'
$latest | Sort-Object name | ForEach-Object { "$($_.status)/$($_.conclusion): $($_.name) ($($_.databaseId))" }
exit 1
