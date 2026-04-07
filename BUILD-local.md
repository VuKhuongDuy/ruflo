# 1. Build memory (dependency của CLI)
cd /Users/alex/Documents/Project/ruflo/v3/@claude-flow/memory && npm run build

# 2. Build CLI (ruflo.js import trực tiếp từ đây)
cd /Users/alex/Documents/Project/ruflo/v3/@claude-flow/cli && npm run build

# Chạy trực tiếp từ source
node /Users/alex/Documents/Project/ruflo/ruflo/bin/ruflo.js memory ingest -d ./docs -n docs

# Hoặc link local package
cd /Users/alex/Documents/Project/ruflo/ruflo
npm link
# Giờ dùng được:
alex-ruflo memory ingest -d ./docs -n docs
Dùng làm MCP trong project khác (local):

claude mcp add alex-ruflo -- node /Users/alex/Documents/Project/ruflo/ruflo/bin/ruflo.js