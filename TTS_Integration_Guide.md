# Coqui TTS 集成指南

本指南将帮助您将 Coqui TTS（文本转语音）功能集成到您的Web应用中。

## 目录

- [介绍](#介绍)
- [安装](#安装)
- [基本用法](#基本用法)
- [方法一：使用 Python API](#方法一使用-python-api)
- [方法二：使用 REST API 服务](#方法二使用-rest-api-服务)
- [方法三：使用 Docker](#方法三使用-docker)
- [Web 应用集成示例](#web-应用集成示例)
- [常见问题解答](#常见问题解答)

## 介绍

Coqui TTS 是一个功能强大的开源文本转语音库，支持多种模型和语言。它提供了以下主要特点：

- 支持多种语言和多种说话人
- 高质量的语音合成
- 支持语音克隆
- 多种模型选择（Tacotron2、VITS、XTTS等）
- 可使用 REST API 或 Python API 方式集成

## 安装

### 基本安装

```bash
pip install TTS
```

### 完整开发环境安装

```bash
git clone https://github.com/coqui-ai/TTS
cd TTS
pip install -e .[all,dev,notebooks]
```

## 基本用法

在集成到您的Web应用之前，建议先了解 Coqui TTS 的基本用法。

## 方法一：使用 Python API

### 单语言单说话人模型

```python
import torch
from TTS.api import TTS

# 检查是否有GPU可用
device = "cuda" if torch.cuda.is_available() else "cpu"

# 初始化 TTS 模型
tts = TTS("tts_models/zh-CN/baker/tacotron2-DDC-GST").to(device)

# 生成语音
wav = tts.tts("这是一个测试文本", speaker=None, language=None)

# 保存到文件
tts.tts_to_file("这是一个测试文本", file_path="output.wav")
```

### 多语言多说话人模型

```python
# 初始化 XTTS 模型
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

# 使用中文进行语音合成
wav = tts.tts(text="这是一个测试文本", speaker_wav="参考说话人音频.wav", language="zh-cn")
tts.tts_to_file(text="这是一个测试文本", speaker_wav="参考说话人音频.wav", language="zh-cn", file_path="output.wav")
```

### 异步处理长文本

对于 Web 应用，通常需要异步处理长文本合成：

```python
import asyncio
from TTS.api import TTS

async def generate_speech(text, output_path, speaker_wav=None, language="zh-cn"):
    """异步生成语音"""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    
    # 为了不阻塞Web应用，使用线程池执行TTS
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None, 
        lambda: tts.tts_to_file(
            text=text, 
            speaker_wav=speaker_wav, 
            language=language, 
            file_path=output_path
        )
    )
    return output_path
```

## 方法二：使用 REST API 服务

Coqui TTS 提供了内置的 REST API 服务器，可以轻松部署为微服务。

### 启动 TTS 服务器

```bash
# 列出可用模型
python -m TTS.server.server --list_models

# 启动服务器 (使用XTTS模型举例)
python -m TTS.server.server --model_name tts_models/multilingual/multi-dataset/xtts_v2 --port 5002
```

### 从 Web 应用调用 API

```javascript
// 使用 JavaScript 调用 TTS API
async function generateSpeech(text, speakerWav, language) {
  const response = await fetch('http://localhost:5002/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      speaker_wav: speakerWav,  // 可选，用于语音克隆
      language_id: language,    // 可选，用于多语言模型
    }),
  });
  
  if (response.ok) {
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    return audioUrl;
  } else {
    throw new Error('TTS API 调用失败');
  }
}

// 使用示例
const playButton = document.getElementById('play-button');
playButton.addEventListener('click', async () => {
  const text = document.getElementById('text-input').value;
  try {
    const audioUrl = await generateSpeech(text, null, 'zh-cn');
    const audioPlayer = document.getElementById('audio-player');
    audioPlayer.src = audioUrl;
    audioPlayer.play();
  } catch (error) {
    console.error('语音生成失败:', error);
  }
});
```

## 方法三：使用 Docker

使用 Docker 可以快速部署 TTS 服务，而无需担心依赖问题。

```bash
# 拉取官方 Docker 镜像
docker pull ghcr.io/coqui-ai/tts-cpu  # CPU 版本
# 或
docker pull ghcr.io/coqui-ai/tts      # GPU 版本

# 启动 TTS 服务器
docker run --rm -it -p 5002:5002 ghcr.io/coqui-ai/tts-cpu python3 TTS/server/server.py --model_name tts_models/multilingual/multi-dataset/xtts_v2
```

## Web 应用集成示例

以下是一个完整的 Flask 应用示例，展示如何集成 TTS 功能：

```python
from flask import Flask, request, jsonify, send_file
import os
import uuid
from TTS.api import TTS
import torch

app = Flask(__name__)

# 初始化 TTS 模型
device = "cuda" if torch.cuda.is_available() else "cpu"
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

# 确保输出目录存在
os.makedirs("static/audio", exist_ok=True)

@app.route('/api/tts', methods=['POST'])
def generate_speech():
    data = request.json
    
    # 获取请求参数
    text = data.get('text', '')
    language = data.get('language', 'zh-cn')
    
    if not text:
        return jsonify({"error": "文本不能为空"}), 400
    
    # 生成唯一文件名
    filename = f"{uuid.uuid4()}.wav"
    output_path = os.path.join("static/audio", filename)
    
    try:
        # 生成语音
        tts.tts_to_file(
            text=text,
            language=language,
            file_path=output_path
        )
        
        # 返回音频文件
        return send_file(output_path, mimetype="audio/wav")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/')
def index():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>TTS Demo</title>
        <script>
            async function generateSpeech() {
                const text = document.getElementById('text').value;
                const language = document.getElementById('language').value;
                
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        text: text,
                        language: language
                    }),
                });
                
                if (response.ok) {
                    const audioBlob = await response.blob();
                    const audioUrl = URL.createObjectURL(audioBlob);
                    const audio = document.getElementById('audio');
                    audio.src = audioUrl;
                    audio.play();
                } else {
                    alert('语音生成失败');
                }
            }
        </script>
    </head>
    <body>
        <h1>TTS 语音合成演示</h1>
        <textarea id="text" rows="5" cols="50" placeholder="请输入要转换的文本"></textarea>
        <br>
        <select id="language">
            <option value="zh-cn">中文</option>
            <option value="en">英文</option>
            <option value="ja">日文</option>
            <option value="ko">韩文</option>
        </select>
        <button onclick="generateSpeech()">生成语音</button>
        <br><br>
        <audio id="audio" controls></audio>
    </body>
    </html>
    """

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

## 性能优化建议

1. **使用 GPU 加速**：若可能，使用 GPU 可以显著提升语音合成速度。

2. **预加载模型**：避免每次请求都加载模型，而是在应用启动时加载一次。

3. **实现缓存机制**：对相同文本的请求可以缓存结果，避免重复计算。

4. **批处理长文本**：将长文本分割成句子，并行处理以提高效率。

5. **使用轻量级模型**：对于低延迟要求的场景，可以选择速度更快的模型。

## 常见问题解答

### Q: 如何处理长文本？
A: 对于长文本，Coqui TTS 会自动分割成句子进行合成。对于Web应用，建议实现异步处理和进度反馈。

### Q: 如何降低资源消耗？
A: 可以选择较小的模型，如 Tacotron2 而非 XTTS；或在低资源设备上部署时使用 Flask API 方式而不是直接集成。

### Q: 支持哪些语言？
A: Coqui TTS 支持多种语言，XTTS v2 模型支持约16种语言。使用 `tts.list_models()` 查看所有可用模型和支持的语言。

### Q: 如何实现实时语音合成？
A: 对于实时应用，建议:
1. 使用速度更快的模型
2. 预热模型避免冷启动延迟
3. 实现流式处理，边生成边播放
4. 使用WebSocket实时返回生成的音频片段

### Q: 如何调整语音质量和速度？
A: 某些模型支持调整语速参数，例如:
```python
tts.tts(text="这是一个示例", speed=1.2)  # 速度调快20%
```

---

## 参考资源

- [Coqui TTS GitHub](https://github.com/coqui-ai/TTS)
- [Coqui TTS 文档](https://tts.readthedocs.io/)
- [预训练模型列表](https://github.com/coqui-ai/TTS/releases) 