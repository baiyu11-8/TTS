#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
TTS_Backend_Integration.py
一个使用Flask和Coqui TTS的文字转语音后端服务示例
"""

import os
import time
import uuid
import threading
import logging
from typing import Dict, Optional
import torch
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# 导入TTS相关模块
from TTS.api import TTS
from TTS.utils.manage import ModelManager
from TTS.utils.synthesizer import Synthesizer

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # 允许跨域请求，用于前端调用

# 创建输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# TTS引擎缓存
tts_engines = {}
tts_lock = threading.Lock()

# 任务状态跟踪
task_status = {}


def get_device():
    """获取设备（GPU或CPU）"""
    return "cuda" if torch.cuda.is_available() else "cpu"


def get_tts_engine(model_name: str) -> TTS:
    """
    获取或创建TTS引擎实例
    
    Args:
        model_name: 模型名称
        
    Returns:
        TTS引擎实例
    """
    with tts_lock:
        if model_name not in tts_engines:
            logger.info(f"初始化TTS引擎: {model_name}")
            device = get_device()
            tts_engines[model_name] = TTS(model_name).to(device)
        return tts_engines[model_name]


@app.route("/api/models", methods=["GET"])
def list_models():
    """列出可用的TTS模型"""
    try:
        manager = ModelManager()
        models = manager.list_tts_models()
        
        # 筛选常用模型
        common_models = [
            model for model in models 
            if "zh" in model or "en" in model or "multi" in model
        ]
        
        return jsonify({
            "models": common_models,
            "total": len(models),
            "common_models_count": len(common_models)
        })
    except Exception as e:
        logger.error(f"列出模型时出错: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/tts", methods=["POST"])
def text_to_speech():
    """
    文本转语音API端点
    
    请求参数:
        - text: 要转换的文本
        - model_name: 模型名称(可选，默认使用中文模型)
        - language: 语言代码(可选，默认为"zh-cn")
        - speaker_id: 说话人ID(可选)
        - speaker_wav: 参考说话人音频文件(可选)
    
    返回:
        - 生成的音频文件
    """
    try:
        # 获取请求参数
        if request.is_json:
            data = request.json
            text = data.get("text", "")
            model_name = data.get("model_name", "tts_models/zh-CN/baker/tacotron2-DDC-GST")
            language = data.get("language", "zh-cn")
            speaker_id = data.get("speaker_id")
            speaker_wav = data.get("speaker_wav")
        else:
            # 处理表单数据
            text = request.form.get("text", "")
            model_name = request.form.get("model_name", "tts_models/zh-CN/baker/tacotron2-DDC-GST")
            language = request.form.get("language", "zh-cn")
            speaker_id = request.form.get("speaker_id")
            # 处理上传的参考音频文件
            speaker_wav = None
            if "speaker_wav" in request.files:
                speaker_file = request.files["speaker_wav"]
                if speaker_file.filename:
                    temp_path = os.path.join(OUTPUT_DIR, f"ref_{uuid.uuid4()}.wav")
                    speaker_file.save(temp_path)
                    speaker_wav = temp_path
        
        # 验证输入
        if not text:
            return jsonify({"error": "请提供文本内容"}), 400
        
        # 创建任务ID
        task_id = str(uuid.uuid4())
        task_status[task_id] = {"status": "processing", "progress": 0}
        
        # 获取TTS引擎
        tts_engine = get_tts_engine(model_name)
        
        # 生成输出文件名
        output_filename = f"tts_{task_id}.wav"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        
        # 生成语音
        logger.info(f"正在生成语音，任务ID: {task_id}, 文本: {text[:50]}...")
        
        # 更新任务状态为进行中
        task_status[task_id]["status"] = "processing"
        task_status[task_id]["progress"] = 50
        
        # 使用TTS引擎生成语音
        tts_engine.tts_to_file(
            text=text,
            speaker=speaker_id,
            language=language,
            speaker_wav=speaker_wav,
            file_path=output_path
        )
        
        # 更新任务状态为完成
        task_status[task_id]["status"] = "completed"
        task_status[task_id]["progress"] = 100
        
        # 返回生成的音频文件
        return send_file(
            output_path,
            mimetype="audio/wav",
            as_attachment=True,
            download_name=output_filename
        )
    
    except Exception as e:
        logger.error(f"生成语音时出错: {str(e)}")
        if task_id in task_status:
            task_status[task_id]["status"] = "failed"
            task_status[task_id]["error"] = str(e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/tts/async", methods=["POST"])
def async_text_to_speech():
    """
    异步文本转语音API端点
    
    请求参数与同步端点相同，但会立即返回任务ID，
    客户端可以使用任务ID查询状态和获取结果
    """
    try:
        # 获取请求参数
        if request.is_json:
            data = request.json
            text = data.get("text", "")
            model_name = data.get("model_name", "tts_models/zh-CN/baker/tacotron2-DDC-GST")
            language = data.get("language", "zh-cn")
            speaker_id = data.get("speaker_id")
            speaker_wav = data.get("speaker_wav")
        else:
            # 处理表单数据
            text = request.form.get("text", "")
            model_name = request.form.get("model_name", "tts_models/zh-CN/baker/tacotron2-DDC-GST")
            language = request.form.get("language", "zh-cn")
            speaker_id = request.form.get("speaker_id")
            # 处理上传的参考音频文件
            speaker_wav = None
            if "speaker_wav" in request.files:
                speaker_file = request.files["speaker_wav"]
                if speaker_file.filename:
                    temp_path = os.path.join(OUTPUT_DIR, f"ref_{uuid.uuid4()}.wav")
                    speaker_file.save(temp_path)
                    speaker_wav = temp_path
        
        # 验证输入
        if not text:
            return jsonify({"error": "请提供文本内容"}), 400
        
        # 创建任务ID
        task_id = str(uuid.uuid4())
        
        # 初始化任务状态
        task_status[task_id] = {
            "status": "queued",
            "progress": 0,
            "created_at": time.time(),
            "output_filename": f"tts_{task_id}.wav"
        }
        
        # 在后台线程中执行TTS任务
        threading.Thread(
            target=process_tts_task,
            args=(task_id, text, model_name, language, speaker_id, speaker_wav),
            daemon=True
        ).start()
        
        # 立即返回任务ID
        return jsonify({
            "task_id": task_id,
            "status": "queued",
            "message": "TTS任务已加入队列"
        })
    
    except Exception as e:
        logger.error(f"创建异步TTS任务时出错: {str(e)}")
        return jsonify({"error": str(e)}), 500


def process_tts_task(
    task_id: str,
    text: str,
    model_name: str,
    language: str,
    speaker_id: Optional[str],
    speaker_wav: Optional[str]
):
    """
    在后台处理TTS任务
    
    Args:
        task_id: 任务ID
        text: 要转换的文本
        model_name: 模型名称
        language: 语言代码
        speaker_id: 说话人ID(可选)
        speaker_wav: 参考说话人音频文件路径(可选)
    """
    try:
        # 更新任务状态为处理中
        task_status[task_id]["status"] = "processing"
        task_status[task_id]["progress"] = 10
        
        # 获取TTS引擎
        tts_engine = get_tts_engine(model_name)
        
        # 生成输出文件路径
        output_filename = f"tts_{task_id}.wav"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        
        # 更新进度
        task_status[task_id]["progress"] = 30
        
        # 生成语音
        logger.info(f"正在生成语音，任务ID: {task_id}, 文本: {text[:50]}...")
        
        # 使用TTS引擎生成语音
        tts_engine.tts_to_file(
            text=text,
            speaker=speaker_id,
            language=language,
            speaker_wav=speaker_wav,
            file_path=output_path
        )
        
        # 更新任务状态为完成
        task_status[task_id]["status"] = "completed"
        task_status[task_id]["progress"] = 100
        task_status[task_id]["completed_at"] = time.time()
        task_status[task_id]["output_path"] = output_path
        
        logger.info(f"TTS任务完成: {task_id}")
        
    except Exception as e:
        logger.error(f"处理TTS任务时出错: {str(e)}")
        task_status[task_id]["status"] = "failed"
        task_status[task_id]["error"] = str(e)


@app.route("/api/tts/status/<task_id>", methods=["GET"])
def get_task_status(task_id: str):
    """
    获取异步TTS任务的状态
    
    Args:
        task_id: 任务ID
        
    Returns:
        任务状态信息
    """
    if task_id not in task_status:
        return jsonify({"error": "找不到任务"}), 404
    
    return jsonify(task_status[task_id])


@app.route("/api/tts/result/<task_id>", methods=["GET"])
def get_task_result(task_id: str):
    """
    获取异步TTS任务的结果
    
    Args:
        task_id: 任务ID
        
    Returns:
        生成的音频文件
    """
    if task_id not in task_status:
        return jsonify({"error": "找不到任务"}), 404
    
    task = task_status[task_id]
    
    if task["status"] != "completed":
        return jsonify({
            "error": "任务尚未完成",
            "status": task["status"],
            "progress": task["progress"]
        }), 400
    
    output_path = os.path.join(OUTPUT_DIR, f"tts_{task_id}.wav")
    
    if not os.path.exists(output_path):
        return jsonify({"error": "找不到输出文件"}), 404
    
    return send_file(
        output_path,
        mimetype="audio/wav",
        as_attachment=True,
        download_name=f"tts_{task_id}.wav"
    )


@app.route("/")
def index():
    """主页"""
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>TTS API服务</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
            h1 { color: #333; }
            code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
            pre { background: #f8f8f8; padding: 10px; border-radius: 5px; overflow-x: auto; }
            .endpoint { margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <h1>文字转语音(TTS) API服务</h1>
        <p>这是一个基于Coqui TTS的文字转语音API服务。您可以使用以下端点:</p>
        
        <div class="endpoint">
            <h3>GET /api/models</h3>
            <p>列出所有可用的TTS模型</p>
        </div>
        
        <div class="endpoint">
            <h3>POST /api/tts</h3>
            <p>同步文本转语音</p>
            <pre>
请求参数:
- text: 要转换的文本
- model_name: 模型名称(可选)
- language: 语言代码(可选)
- speaker_id: 说话人ID(可选)
- speaker_wav: 参考说话人音频文件(可选)
            </pre>
        </div>
        
        <div class="endpoint">
            <h3>POST /api/tts/async</h3>
            <p>异步文本转语音</p>
            <pre>
请求参数: 与同步接口相同
返回: 任务ID，用于检查状态和获取结果
            </pre>
        </div>
        
        <div class="endpoint">
            <h3>GET /api/tts/status/&lt;task_id&gt;</h3>
            <p>获取异步任务状态</p>
        </div>
        
        <div class="endpoint">
            <h3>GET /api/tts/result/&lt;task_id&gt;</h3>
            <p>获取异步任务结果(音频文件)</p>
        </div>
    </body>
    </html>
    """


if __name__ == "__main__":
    # 在生产环境中，应使用生产级别的WSGI服务器如Gunicorn
    app.run(host="0.0.0.0", port=5002, debug=False) 