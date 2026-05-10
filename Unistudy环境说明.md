# Unistudy 环境说明

本作品为桌面端应用，提供可直接安装使用的 Windows 安装包。评审老师或使用者如果只是体验作品功能，只需运行提交材料中的安装包，按照提示完成安装后即可直接使用本作品，无需额外安装开发工具，也无需手动配置项目依赖环境。

如果需要查看源代码、了解具体实现过程，或在本地进行二次开发与复现运行，则可使用 Visual Studio Code 打开项目源代码文件夹。源码运行环境需提前安装 Node.js，推荐使用 Node.js 20 LTS 版本。打开项目后，可在终端中执行 `npm install` 安装项目运行所需依赖，安装完成后执行 `npm start` 启动项目。也就是说，只有在需要进行源码复现、调试或修改时，才需要使用 `npm install` 和 `npm start` 等命令。

需要特别说明的是，提交的源代码文件夹中不包含 `node_modules` 目录。该目录用于存放项目依赖文件，体积较大，且其内容可以通过执行 `npm install` 自动下载和生成，因此无需随作品一起打包提交。这样既能保证提交文件体积更合理，也不会影响项目源码的正常复现。

本作品的日常使用方式与源码复现方式是分开的：直接体验作品时使用安装包即可；只有在查看源代码、调试程序或本地复现项目时，才需要安装 Node.js 并通过 `npm install` 自动补全依赖环境。

## API Key 配置说明

项目内置的 AI&P 创新实践项目测试预设会优先读取环境变量 `UNISTUDY_AIP_TEST_API_KEY`。如果没有设置该环境变量，则使用竞赛评审安装包中随包提供的测试 Key，保证评委直接安装后也能体验联网功能。

源码运行时可以这样覆盖：

```powershell
$env:UNISTUDY_AIP_TEST_API_KEY="your-api-key"
npm start
```

macOS / Linux 可使用：

```sh
UNISTUDY_AIP_TEST_API_KEY="your-api-key" npm start
```

如果后续不希望源码中保留随包测试 Key，只需要把 `src/modules/main/utils/modelService.js` 中的 `PACKAGED_AIP_TEST_API_KEY` 改为空字符串或删除 fallback，即可变成完全依赖环境变量的模式。

也可以用一个 JSON 环境变量覆盖整套评测预设，包括名称、端点、模型列表和默认模型：

```powershell
$env:UNISTUDY_AIP_TEST_PRESET_CONFIG='{"name":"Contest Review Proxy","apiBaseUrl":"https://proxy.example.com/openai","apiKey":"your-api-key","models":[{"id":"review-chat","name":"Review Chat","group":"chat","capabilities":{"chat":true,"embedding":false,"rerank":false,"vision":true,"reasoning":true}},{"id":"review-embedding","name":"Review Embedding","group":"embedding","capabilities":{"chat":false,"embedding":true,"rerank":false,"vision":false,"reasoning":false}},{"id":"review-rerank","name":"Review Rerank","group":"rerank","capabilities":{"chat":false,"embedding":false,"rerank":true,"vision":false,"reasoning":false}}],"defaults":{"chat":"review-chat","thinkingChat":"review-chat","chatFallback":"review-chat","followUp":"review-chat","studyTool":"review-chat","topicTitle":"review-chat","sourceGuide":"review-chat","imageTranscription":"review-chat","embedding":"review-embedding","rerank":"review-rerank"}}'
npm start
```

其中 `UNISTUDY_AIP_TEST_API_KEY` 的优先级高于 JSON 内的 `apiKey`，适合在同一套模型预设下临时替换 Key。
