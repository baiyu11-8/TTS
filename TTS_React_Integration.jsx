/**
 * TTSComponent.jsx
 * 一个用于在React应用中集成TTS功能的组件
 */

import React, { useState, useRef, useEffect } from 'react';

/**
 * 文字转语音组件 
 * 
 * @param {Object} props
 * @param {string} props.apiEndpoint - TTS API端点
 * @param {string[]} props.availableLanguages - 可用语言列表
 * @param {Function} props.onGenerateSuccess - 生成成功时的回调函数
 * @param {Function} props.onError - 错误时的回调函数
 */
const TTSComponent = ({ 
  apiEndpoint = 'http://localhost:5002/api/tts',
  availableLanguages = ['zh-cn', 'en', 'ja', 'ko', 'fr', 'de'], 
  onGenerateSuccess = () => {}, 
  onError = () => {} 
}) => {
  // 状态定义
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('zh-cn');
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState('');
  const [speakerFile, setSpeakerFile] = useState(null);
  const [speakerFileName, setSpeakerFileName] = useState('');
  const [useAsync, setUseAsync] = useState(false);
  const [asyncStatus, setAsyncStatus] = useState({ taskId: '', status: '', progress: 0 });

  // 引用
  const audioRef = useRef(null);
  const statusCheckInterval = useRef(null);

  // 处理输入文本变化
  const handleTextChange = (e) => {
    setText(e.target.value);
    if (error) setError('');
  };

  // 处理语言选择变化
  const handleLanguageChange = (e) => {
    setLanguage(e.target.value);
  };

  // 处理参考音频文件上传
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type !== 'audio/wav') {
        setError('只支持WAV格式的音频文件');
        return;
      }
      
      setSpeakerFile(file);
      setSpeakerFileName(file.name);
    } else {
      setSpeakerFile(null);
      setSpeakerFileName('');
    }
  };

  // 清除状态
  const clearStatus = () => {
    if (statusCheckInterval.current) {
      clearInterval(statusCheckInterval.current);
      statusCheckInterval.current = null;
    }
    setAsyncStatus({ taskId: '', status: '', progress: 0 });
  };

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      // 清理URL对象，避免内存泄漏
      if (audioUrl && audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
      
      // 清理轮询
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
      }
    };
  }, [audioUrl]);

  // 同步生成语音
  const generateSpeechSync = async () => {
    if (!text.trim()) {
      setError('请输入要转换的文本');
      return;
    }

    try {
      setIsGenerating(true);
      setError('');
      
      // 创建FormData对象
      const formData = new FormData();
      formData.append('text', text);
      formData.append('language', language);
      
      if (speakerFile) {
        formData.append('speaker_wav', speakerFile);
      }

      // 调用TTS API
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `服务器返回错误: ${response.status}`);
      }

      // 获取音频数据并创建URL
      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      
      // 更新状态并播放音频
      setAudioUrl(url);
      
      // 如果有引用，自动播放
      if (audioRef.current) {
        audioRef.current.load();
        audioRef.current.play();
      }
      
      // 调用成功回调
      onGenerateSuccess(url);
    } catch (err) {
      console.error('生成语音出错:', err);
      setError(err.message || '生成语音时出错');
      onError(err);
    } finally {
      setIsGenerating(false);
    }
  };

  // 异步生成语音
  const generateSpeechAsync = async () => {
    if (!text.trim()) {
      setError('请输入要转换的文本');
      return;
    }

    try {
      setIsGenerating(true);
      setError('');
      clearStatus();
      
      // 创建FormData对象
      const formData = new FormData();
      formData.append('text', text);
      formData.append('language', language);
      
      if (speakerFile) {
        formData.append('speaker_wav', speakerFile);
      }

      // 调用异步TTS API
      const response = await fetch(`${apiEndpoint}/async`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `服务器返回错误: ${response.status}`);
      }

      // 获取任务ID
      const responseData = await response.json();
      const taskId = responseData.task_id;
      
      if (!taskId) {
        throw new Error('未收到有效的任务ID');
      }
      
      // 更新任务状态
      setAsyncStatus({
        taskId,
        status: responseData.status || 'queued',
        progress: 0
      });
      
      // 开始轮询任务状态
      statusCheckInterval.current = setInterval(() => {
        checkTaskStatus(taskId);
      }, 1000);
      
    } catch (err) {
      console.error('创建异步任务出错:', err);
      setError(err.message || '创建异步任务时出错');
      onError(err);
      setIsGenerating(false);
    }
  };

  // 检查异步任务状态
  const checkTaskStatus = async (taskId) => {
    try {
      const response = await fetch(`${apiEndpoint}/status/${taskId}`);
      
      if (!response.ok) {
        throw new Error(`获取任务状态出错: ${response.status}`);
      }
      
      const taskData = await response.json();
      
      // 更新任务状态
      setAsyncStatus({
        taskId,
        status: taskData.status,
        progress: taskData.progress || 0
      });
      
      // 如果任务完成，获取结果
      if (taskData.status === 'completed') {
        clearInterval(statusCheckInterval.current);
        statusCheckInterval.current = null;
        fetchTaskResult(taskId);
      }
      
      // 如果任务失败，显示错误
      if (taskData.status === 'failed') {
        clearInterval(statusCheckInterval.current);
        statusCheckInterval.current = null;
        setIsGenerating(false);
        setError(taskData.error || '任务处理失败');
      }
      
    } catch (err) {
      console.error('检查任务状态出错:', err);
      clearInterval(statusCheckInterval.current);
      statusCheckInterval.current = null;
      setIsGenerating(false);
      setError(err.message || '检查任务状态时出错');
    }
  };

  // 获取异步任务结果
  const fetchTaskResult = async (taskId) => {
    try {
      const response = await fetch(`${apiEndpoint}/result/${taskId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `获取任务结果出错: ${response.status}`);
      }
      
      // 获取音频数据并创建URL
      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      
      // 更新状态并播放音频
      setAudioUrl(url);
      
      // 如果有引用，自动播放
      if (audioRef.current) {
        audioRef.current.load();
        audioRef.current.play();
      }
      
      // 调用成功回调
      onGenerateSuccess(url);
    } catch (err) {
      console.error('获取任务结果出错:', err);
      setError(err.message || '获取任务结果时出错');
      onError(err);
    } finally {
      setIsGenerating(false);
    }
  };

  // 处理生成语音按钮点击
  const handleGenerateClick = () => {
    if (useAsync) {
      generateSpeechAsync();
    } else {
      generateSpeechSync();
    }
  };

  // 组件样式
  const styles = {
    container: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      maxWidth: '600px',
      margin: '0 auto',
      padding: '20px',
      borderRadius: '8px',
      backgroundColor: '#fff',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
    },
    title: {
      marginTop: 0,
      color: '#333',
      borderBottom: '1px solid #eee',
      paddingBottom: '10px',
    },
    inputGroup: {
      marginBottom: '20px',
    },
    label: {
      display: 'block',
      marginBottom: '8px',
      fontWeight: 500,
      color: '#555',
    },
    textarea: {
      width: '100%',
      padding: '10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '16px',
    },
    select: {
      width: '100%',
      padding: '10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '16px',
    },
    fileUpload: {
      display: 'flex',
      alignItems: 'center',
    },
    fileBtn: {
      display: 'inline-block',
      padding: '8px 15px',
      backgroundColor: '#f8f8f8',
      border: '1px solid #ddd',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      transition: 'background-color 0.3s',
    },
    fileBtnDisabled: {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
    fileName: {
      marginLeft: '10px',
      color: '#666',
      fontSize: '14px',
    },
    hint: {
      marginTop: '5px',
      fontSize: '12px',
      color: '#888',
    },
    checkboxGroup: {
      display: 'flex',
      alignItems: 'center',
    },
    checkboxLabel: {
      display: 'flex',
      alignItems: 'center',
      cursor: 'pointer',
    },
    checkbox: {
      marginRight: '8px',
    },
    buttonGroup: {
      display: 'flex',
      justifyContent: 'center',
      margin: '20px 0',
    },
    generateBtn: {
      padding: '10px 25px',
      backgroundColor: '#4CAF50',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '16px',
      cursor: 'pointer',
      transition: 'background-color 0.3s',
    },
    generateBtnDisabled: {
      backgroundColor: '#cccccc',
      cursor: 'not-allowed',
    },
    taskStatus: {
      margin: '20px 0',
      padding: '15px',
      borderRadius: '4px',
      backgroundColor: '#f8f8f8',
    },
    statusTitle: {
      marginTop: 0,
      fontSize: '16px',
      color: '#555',
    },
    statusInfo: {
      marginTop: '10px',
    },
    progressBar: {
      height: '10px',
      backgroundColor: '#e0e0e0',
      borderRadius: '5px',
      margin: '10px 0',
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#4CAF50',
      transition: 'width 0.5s',
    },
    progressText: {
      textAlign: 'right',
      fontSize: '12px',
      color: '#666',
      margin: 0,
    },
    audioPlayer: {
      marginTop: '30px',
    },
    audioTitle: {
      marginBottom: '15px',
      fontSize: '16px',
      color: '#555',
    },
    audio: {
      width: '100%',
      marginBottom: '15px',
    },
    audioControls: {
      display: 'flex',
      justifyContent: 'center',
    },
    downloadBtn: {
      display: 'inline-block',
      padding: '8px 20px',
      backgroundColor: '#4a90e2',
      color: 'white',
      textDecoration: 'none',
      borderRadius: '4px',
      transition: 'background-color 0.3s',
    },
    errorMessage: {
      backgroundColor: '#f8d7da',
      border: '1px solid #f5c6cb',
      color: '#721c24',
      padding: '10px 15px',
      borderRadius: '4px',
      marginBottom: '20px',
    },
    hiddenInput: {
      position: 'absolute',
      left: '-9999px',
    }
  };

  // 渲染组件
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>文字转语音</h2>
      
      {/* 错误提示 */}
      {error && (
        <div style={styles.errorMessage}>
          <p>{error}</p>
        </div>
      )}
      
      {/* 文本输入区域 */}
      <div style={styles.inputGroup}>
        <label htmlFor="text-input" style={styles.label}>输入文本:</label>
        <textarea
          id="text-input"
          value={text}
          onChange={handleTextChange}
          placeholder="请输入要转换为语音的文本..."
          rows={5}
          disabled={isGenerating}
          style={styles.textarea}
        />
      </div>
      
      {/* 语言选择 */}
      <div style={styles.inputGroup}>
        <label htmlFor="language-select" style={styles.label}>语言:</label>
        <select
          id="language-select"
          value={language}
          onChange={handleLanguageChange}
          disabled={isGenerating}
          style={styles.select}
        >
          {availableLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {lang === 'zh-cn' ? '中文' :
               lang === 'en' ? '英文' :
               lang === 'ja' ? '日文' :
               lang === 'ko' ? '韩文' :
               lang === 'fr' ? '法文' :
               lang === 'de' ? '德文' : lang}
            </option>
          ))}
        </select>
      </div>
      
      {/* 参考音频上传 */}
      <div style={styles.inputGroup}>
        <label style={styles.label}>参考音频 (用于语音克隆):</label>
        <div style={styles.fileUpload}>
          <input
            type="file"
            id="speaker-file"
            accept="audio/wav"
            onChange={handleFileChange}
            disabled={isGenerating}
            style={styles.hiddenInput}
          />
          <label 
            htmlFor="speaker-file" 
            style={isGenerating ? {...styles.fileBtn, ...styles.fileBtnDisabled} : styles.fileBtn}
          >
            选择WAV文件
          </label>
          <span style={styles.fileName}>{speakerFileName || '未选择文件'}</span>
        </div>
        <p style={styles.hint}>上传一段包含目标说话人声音的短音频(WAV格式)，用于语音克隆</p>
      </div>
      
      {/* 同步/异步模式选择 */}
      <div style={styles.inputGroup}>
        <div style={styles.checkboxGroup}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={useAsync}
              onChange={() => setUseAsync(!useAsync)}
              disabled={isGenerating}
              style={styles.checkbox}
            />
            使用异步模式 (适用于长文本)
          </label>
        </div>
      </div>
      
      {/* 生成按钮 */}
      <div style={styles.buttonGroup}>
        <button
          style={isGenerating || !text.trim() 
            ? {...styles.generateBtn, ...styles.generateBtnDisabled} 
            : styles.generateBtn}
          onClick={handleGenerateClick}
          disabled={isGenerating || !text.trim()}
        >
          {isGenerating ? '正在生成...' : '生成语音'}
        </button>
      </div>
      
      {/* 异步任务状态 */}
      {useAsync && asyncStatus.taskId && (
        <div style={styles.taskStatus}>
          <h3 style={styles.statusTitle}>任务状态</h3>
          <div style={styles.statusInfo}>
            <p>状态: {
              asyncStatus.status === 'queued' ? '排队中' :
              asyncStatus.status === 'processing' ? '处理中' :
              asyncStatus.status === 'completed' ? '已完成' :
              asyncStatus.status === 'failed' ? '失败' : asyncStatus.status
            }</p>
            <div style={styles.progressBar}>
              <div 
                style={{
                  ...styles.progressFill,
                  width: `${asyncStatus.progress}%`
                }}
              ></div>
            </div>
            <p style={styles.progressText}>{asyncStatus.progress}%</p>
          </div>
        </div>
      )}
      
      {/* 音频播放器 */}
      {audioUrl && (
        <div style={styles.audioPlayer}>
          <h3 style={styles.audioTitle}>生成的语音</h3>
          <audio ref={audioRef} controls style={styles.audio}>
            <source src={audioUrl} type="audio/wav" />
            您的浏览器不支持音频元素
          </audio>
          <div style={styles.audioControls}>
            <a
              href={audioUrl}
              download="tts_output.wav"
              style={styles.downloadBtn}
            >
              下载音频
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default TTSComponent;


/**
 * 使用示例:
 * 
 * import TTSComponent from './components/TTSComponent';
 * 
 * function App() {
 *   return (
 *     <div className="App">
 *       <TTSComponent 
 *         apiEndpoint="http://your-tts-server/api/tts"
 *         availableLanguages={['zh-cn', 'en', 'ja']}
 *         onGenerateSuccess={(audioUrl) => console.log('生成成功:', audioUrl)}
 *         onError={(error) => console.error('出错:', error)}
 *       />
 *     </div>
 *   );
 * }
 */ 