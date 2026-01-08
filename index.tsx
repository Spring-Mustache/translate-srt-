
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface SubtitleItem {
  id: string;
  timeRange: string;
  text: string;
}

interface TranslatedItem {
  id: string;
  timeRange: string;
  speaker: string;
  vietnamese: string;
  english: string;
  chinese: string;
}

// --- Helper Functions ---

const parseSRT = (content: string): SubtitleItem[] => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks = normalized.split("\n\n");
  const items: SubtitleItem[] = [];

  for (const chunk of chunks) {
    const lines = chunk.trim().split("\n");
    if (lines.length >= 3) {
      const id = lines[0].trim();
      const timeRange = lines[1].trim();
      const text = lines.slice(2).join("\n").trim();
      items.push({ id, timeRange, text });
    }
  }
  return items;
};

const stringifySRT = (items: TranslatedItem[], lang: 'vietnamese' | 'english' | 'chinese'): string => {
  return items
    .map((item) => {
      const speakerLabel = item.speaker ? `[${item.speaker}] ` : "";
      return `${item.id}\n${item.timeRange}\n${speakerLabel}${item[lang]}`;
    })
    .join("\n\n");
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

// --- Icons ---
const UploadIcon = () => (
  <svg className="w-8 h-8 mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
);
const CheckIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
);

// --- Components ---

function App() {
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<TranslatedItem[]>([]);
  const [isLiteMode, setIsLiteMode] = useState(false);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'video' | 'srt') => {
    if (e.target.files && e.target.files[0]) {
      if (type === 'video') setVideoFile(e.target.files[0]);
      else setSrtFile(e.target.files[0]);
    }
  };

  const processTranslation = async () => {
    if (!srtFile) {
      alert("Vui lòng chọn file SRT!");
      return;
    }

    setIsProcessing(true);
    setResults([]);
    setProgress(0);
    setStatus("Đang đọc file...");

    try {
      const text = await srtFile.text();
      const subtitleItems = parseSRT(text);
      
      if (subtitleItems.length === 0) {
        throw new Error("File SRT lỗi hoặc trống.");
      }

      let videoPart: any = null;
      if (!isLiteMode && videoFile) {
        if (videoFile.size > 50 * 1024 * 1024) {
          const confirmLarge = confirm("Video lớn hơn 50MB có thể làm đơ máy yếu. Bạn có muốn tiếp tục dùng video không? (Cancel để chuyển sang chế độ chỉ dùng Text)");
          if (!confirmLarge) {
            setIsLiteMode(true);
            setStatus("Đã chuyển sang chế độ Text Only (Máy yếu)...");
          } else {
            setStatus("Đang mã hóa video (việc này có thể mất chút thời gian)...");
            const base64 = await fileToBase64(videoFile);
            videoPart = {
              inlineData: {
                mimeType: videoFile.type,
                data: base64,
              },
            };
          }
        } else {
            setStatus("Đang xử lý video...");
            const base64 = await fileToBase64(videoFile);
            videoPart = {
              inlineData: {
                mimeType: videoFile.type,
                data: base64,
              },
            };
        }
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const modelId = "gemini-3-flash-preview"; 
      
      const BATCH_SIZE = 50; 
      const totalBatches = Math.ceil(subtitleItems.length / BATCH_SIZE);
      const identifiedSpeakers = new Set<string>();

      for (let i = 0; i < subtitleItems.length; i += BATCH_SIZE) {
        const batch = subtitleItems.slice(i, i + BATCH_SIZE);
        const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
        
        setStatus(`Đang dịch & phân vai phần ${currentBatchNum} / ${totalBatches}...`);
        
        const knownSpeakersList = Array.from(identifiedSpeakers).join(", ");

        const prompt = `
          Bạn là một dịch giả phim chuyên nghiệp kiêm biên kịch.
          NHIỆM VỤ:
          1. Xác định NGƯỜI NÓI (Speaker).
             - Video có: Nhìn hình/nghe giọng.
             - Text nhắc tên: Dùng tên đó.
             - Không biết: Ghi "Nam 1" (Male 1), "Nữ 1" (Female 1)... 
             - Nhất quán với: [${knownSpeakersList}].
          2. Dịch phụ đề sang Tiếng Việt (tự nhiên), Tiếng Anh và Tiếng Trung (Giản thể).
          
          Input Data:
          ${JSON.stringify(batch)}

          Output JSON:
          [ { "id": "...", "timeRange": "...", "speaker": "...", "vietnamese": "...", "english": "...", "chinese": "..." } ]
        `;

        const parts: any[] = [];
        if (videoPart) parts.push(videoPart);
        parts.push({ text: prompt });

        const response = await ai.models.generateContent({
          model: modelId,
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  timeRange: { type: Type.STRING },
                  speaker: { type: Type.STRING },
                  vietnamese: { type: Type.STRING },
                  english: { type: Type.STRING },
                  chinese: { type: Type.STRING },
                },
                required: ["id", "timeRange", "speaker", "vietnamese", "english", "chinese"],
              },
            },
          },
        });

        if (response.text) {
          const jsonBatch = JSON.parse(response.text) as TranslatedItem[];
          jsonBatch.forEach(item => {
            if (item.speaker) identifiedSpeakers.add(item.speaker);
          });
          setResults((prev) => [...prev, ...jsonBatch]);
        }

        setProgress(Math.round(((i + BATCH_SIZE) / subtitleItems.length) * 100));
      }

      setStatus("Hoàn tất!");
      setIsProcessing(false);

    } catch (error: any) {
      console.error(error);
      setStatus(`Lỗi: ${error.message}`);
      setIsProcessing(false);
    }
  };

  const downloadFile = (lang: 'vietnamese' | 'english' | 'chinese') => {
    if (results.length === 0) return;
    const content = stringifySRT(results, lang);
    const blob = new Blob([content], { type: "text/srt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subtitle_${lang}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100 font-sans selection:bg-blue-500/30">
      <nav className="border-b border-gray-800 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white">AI</div>
            <span className="font-semibold text-lg tracking-tight">SubTranslator Pro</span>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded-full border border-gray-800">
                <span className={`w-2 h-2 rounded-full ${isLiteMode ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                <span className="text-xs font-medium text-gray-400">Chế độ Máy Yếu</span>
                <button 
                  onClick={() => setIsLiteMode(!isLiteMode)}
                  className={`w-10 h-5 rounded-full relative transition-colors duration-200 ${isLiteMode ? 'bg-blue-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform duration-200 ${isLiteMode ? 'translate-x-5' : 'translate-x-0'}`}></span>
                </button>
             </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-12 gap-8">
          
          {/* Left Column */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#111] rounded-2xl p-6 border border-gray-800 shadow-xl">
              <h2 className="text-xl font-semibold mb-4 text-gray-200 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-sm">1</span>
                Tải lên File
              </h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-400 mb-2">File Phụ đề gốc (.srt)</label>
                <div className="relative group">
                  <input
                    type="file"
                    accept=".srt,.txt"
                    onChange={(e) => handleFileChange(e, 'srt')}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={cn(
                    "border-2 border-dashed border-gray-700 rounded-xl p-4 flex flex-col items-center justify-center transition-all group-hover:border-blue-500 group-hover:bg-gray-800/50",
                    srtFile ? "border-green-500/50 bg-green-500/5" : ""
                  )}>
                    {srtFile ? <CheckIcon /> : <UploadIcon />}
                    <span className="text-sm text-gray-400 mt-2 text-center truncate w-full px-2">
                      {srtFile ? srtFile.name : "Kéo thả hoặc Click chọn file"}
                    </span>
                  </div>
                </div>
              </div>

              <div className={cn("transition-opacity duration-300", isLiteMode ? "opacity-40 pointer-events-none grayscale" : "opacity-100")}>
                <label className="block text-sm font-medium text-gray-400 mb-2">Video Gốc (Tùy chọn)</label>
                <div className="relative group">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => handleFileChange(e, 'video')}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    disabled={isLiteMode}
                  />
                  <div className={cn(
                    "border-2 border-dashed border-gray-700 rounded-xl p-4 flex flex-col items-center justify-center transition-all group-hover:border-purple-500 group-hover:bg-gray-800/50",
                    videoFile ? "border-green-500/50 bg-green-500/5" : ""
                  )}>
                    {videoFile ? <CheckIcon /> : <UploadIcon />}
                    <span className="text-sm text-gray-400 mt-2 text-center truncate w-full px-2">
                      {videoFile ? videoFile.name : "Kéo thả hoặc Click chọn Video"}
                    </span>
                  </div>
                </div>
                {isLiteMode && <p className="text-xs text-yellow-500 mt-2">Đã tắt Video để tối ưu cho máy yếu</p>}
              </div>

              <button
                onClick={processTranslation}
                disabled={isProcessing || !srtFile}
                className={cn(
                  "w-full mt-6 py-3 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95",
                  isProcessing || !srtFile
                    ? "bg-gray-700 cursor-not-allowed text-gray-400"
                    : "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 hover:shadow-blue-500/25"
                )}
              >
                {isProcessing ? "Đang xử lý..." : "Bắt đầu Dịch AI"}
              </button>
            </div>

            <div className="bg-[#111] rounded-2xl p-6 border border-gray-800">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-400">Trạng thái</span>
                <span className="text-xs text-gray-500">{Math.min(progress, 100)}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-1.5 mb-3 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5 rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(progress, 100)}%` }}
                ></div>
              </div>
              <p className="text-sm text-blue-400 animate-pulse font-mono truncate">{status || "Sẵn sàng"}</p>
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8 flex flex-col h-[calc(100vh-8rem)]">
             <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-200">Kết quả Dịch thuật</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={() => downloadFile('vietnamese')}
                    disabled={results.length === 0}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 border border-gray-700"
                  >
                    <span className="text-red-500">▼</span> Tiếng Việt
                  </button>
                  <button 
                    onClick={() => downloadFile('english')}
                    disabled={results.length === 0}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 border border-gray-700"
                  >
                    <span className="text-blue-500">▼</span> English
                  </button>
                  <button 
                    onClick={() => downloadFile('chinese')}
                    disabled={results.length === 0}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 border border-gray-700"
                  >
                    <span className="text-yellow-500">▼</span> Tiếng Trung
                  </button>
                </div>
             </div>

             <div className="flex-1 bg-[#111] rounded-2xl border border-gray-800 overflow-hidden relative flex flex-col shadow-inner">
                <div className="grid grid-cols-12 bg-gray-900/50 border-b border-gray-800 p-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="col-span-2">Time/Speaker</div>
                  <div className="col-span-4 border-l border-gray-800 pl-2">Tiếng Việt</div>
                  <div className="col-span-3 border-l border-gray-800 pl-2">English</div>
                  <div className="col-span-3 border-l border-gray-800 pl-2">Tiếng Trung</div>
                </div>
                
                <div className="overflow-y-auto flex-1 p-0 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                  {results.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600">
                      <div className="w-16 h-16 mb-4 rounded-full bg-gray-800/50 flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      </div>
                      <p>Chưa có dữ liệu. Hãy tải file lên để bắt đầu.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {results.map((item) => (
                        <div key={item.id} className="grid grid-cols-12 p-4 hover:bg-gray-800/30 transition-colors group text-sm">
                          <div className="col-span-2 pr-2">
                            <div className="font-mono text-yellow-600 text-[10px] mb-1 opacity-70">{item.timeRange.split(' --> ')[0]}</div>
                            <div className="inline-block bg-gray-800 text-blue-300 text-xs px-2 py-0.5 rounded border border-gray-700/50 font-medium truncate max-w-full" title={item.speaker}>
                              {item.speaker || "Unknown"}
                            </div>
                          </div>
                          
                          <div className="col-span-4 border-l border-gray-800/50 pl-2 text-gray-200 leading-relaxed group-hover:text-white font-sub text-lg tracking-wide">
                            {item.vietnamese}
                          </div>
                          
                          <div className="col-span-3 border-l border-gray-800/50 pl-2 text-gray-400 leading-relaxed font-sub tracking-wide">
                            {item.english}
                          </div>

                          <div className="col-span-3 border-l border-gray-800/50 pl-2 text-gray-400 leading-relaxed font-sub tracking-wide">
                            {item.chinese}
                          </div>
                        </div>
                      ))}
                      <div className="h-2" />
                    </div>
                  )}
                </div>
             </div>
          </div>

        </div>
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(<App />);
