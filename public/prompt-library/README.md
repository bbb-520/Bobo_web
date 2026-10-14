# 提示词封面

当前封面由前端原创 SVG 绘制，是风格示意，不代表提示词的实际生成效果。浏览和复制不调用模型。

后续换图：

1. 从 `src/data/prompt-gallery.json` 找到目标条目的 `id`（不要依赖列表顺序或标题）。
2. 把自己的图片放到 `public/prompt-library/covers/`，建议 WebP/JPEG，宽度 800～1200 像素。
3. 在同目录的 `covers.json` 中添加对应关系：

```json
{
  "schemaVersion": 1,
  "covers": {
    "替换为条目的真实UUID": "/prompt-library/covers/my-poster.webp"
  }
}
```

也可填允许公开访问的 HTTPS 图片地址。不要填私密图片、带签名的临时链接或访问密钥。服务器只分发配置，浏览器直接读取图片；图片失败会回退到示意封面。个人视觉记忆不会使用这份公开映射。

修改源文件后重新构建和部署前端。静态发行文件也保留 `prompt-library/covers.json` 和 `prompt-library/covers/`；临时修改运行中的容器文件会在下次部署时丢失，应始终把最终图片和映射同步到仓库。

上游提示词出处和许可位于 `third-party/`。图片须由你拥有或获得使用授权；上游提示词的 MIT 许可不替代图片使用权。
