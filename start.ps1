# Dev launcher.
#   .\start.ps1          backend + frontend + browser
#   .\start.ps1 -Graph   the above, plus the graphify knowledge graph
param(
    [switch]$Graph
)

# Start backend (Django) in a new terminal window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; .\.venv\Scripts\Activate.ps1; python manage.py runserver"

# Start frontend (Vite) in a new terminal window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev"

# Wait a moment for Vite to spin up, then open the browser
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"

# ── Graphify knowledge graph ────────────────────────────────────────────────
# Interactive map of the whole project (1.8 MB, fully offline — no server).
# Opened only with -Graph so a normal dev start stays fast.
#
# To rebuild it after significant code changes, run in Claude Code:
#     /graphify .              full rebuild
#     /graphify . --update     incremental, only re-reads changed files
# Outputs land in graphify-out/ (gitignored): graph.html, GRAPH_REPORT.md, graph.json
if ($Graph) {
    $graphPath = Join-Path $PSScriptRoot "graphify-out\graph.html"
    if (Test-Path $graphPath) {
        Start-Process $graphPath
    } else {
        Write-Host "No graph yet - run '/graphify .' in Claude Code to build it." -ForegroundColor Yellow
    }
}
