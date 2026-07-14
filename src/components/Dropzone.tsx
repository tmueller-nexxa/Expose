import { useRef, useState, type ReactNode } from "react";
import { IconUpload } from "./Icons";

interface Props {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: string;
  children?: ReactNode;
  compact?: boolean;
}

export function Dropzone({
  accept,
  multiple = true,
  onFiles,
  title,
  hint,
  compact,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function handle(files: FileList | null) {
    if (!files || files.length === 0) return;
    onFiles(Array.from(files));
  }

  return (
    <div
      className={`dropzone ${over ? "over" : ""} ${compact ? "compact" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="dz-icon">
        <IconUpload size={compact ? 20 : 26} />
      </div>
      <div className="dz-title">{title}</div>
      {hint && <div className="dz-hint">{hint}</div>}
    </div>
  );
}
