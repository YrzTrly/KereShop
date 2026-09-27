'use client';

import { useEffect, useRef, useState } from 'react';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — must match the cap in /api/upload

export default function ImageUpload({ value, onChange }) {
  const [preview, setPreview] = useState(value || '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);
  const objectUrlRef = useRef('');
  const requestRef = useRef(0);

  // Keep the preview in sync when the value changes from outside
  // (loading the form, or the URL input below).
  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
    setPreview(value || '');
  }, [value]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported (PNG, JPG, WebP…).');
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('Image is too large — keep it under 5 MB.');
      return;
    }

    setError('');
    setUploading(true);
    const id = ++requestRef.current;

    const objUrl = URL.createObjectURL(file);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = objUrl;
    setPreview(objUrl);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (id !== requestRef.current) return; // a newer upload replaced this one
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setUploading(false);
      onChange(data.url);
    } catch (e) {
      if (id !== requestRef.current) return;
      setUploading(false);
      setError(e.message || 'Upload failed. Please try again.');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer?.files?.[0]);
  }

  return (
    <div className="flex items-start gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload product image"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={`relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition ${
          dragActive ? 'border-brand bg-brand-soft' : 'border-line bg-panel hover:border-brand/60'
        }`}
      >
        {preview ? (
          <img src={preview} alt="Product preview" className="h-full w-full object-cover" />
        ) : (
          <span className="px-2 text-center text-[11px] leading-tight text-muted">
            Drag &amp; drop
            <br />
            or browse
          </span>
        )}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-panel/80">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </span>
        )}
        {(preview || uploading) && (
          <button
            type="button"
            title="Remove image"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-panel/90 text-[13px] font-bold text-bad shadow hover:bg-panel"
          >
            ×
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {uploading && <p className="text-[12px] text-muted">Uploading image…</p>}
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>
    </div>
  );
}