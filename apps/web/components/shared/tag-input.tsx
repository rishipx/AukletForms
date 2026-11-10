'use client';

import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { normalizeDomain } from '@/lib/forms/validation';
import { cn } from '@/lib/utils';

interface TagInputProps {
  id: string;
  /** Each tag is submitted as its own `name` entry (FormData.getAll). */
  name: string;
  defaultValue?: string[];
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}

export function TagInput({ id, name, defaultValue = [], placeholder, invalid, describedBy }: TagInputProps) {
  const [tags, setTags] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const parts = raw
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => normalizeDomain(p) ?? p); // keep invalid text visible so the user can fix it
    if (parts.length > 0) setTags((prev) => Array.from(new Set([...prev, ...parts])));
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ' || (event.key === 'Tab' && draft.trim() !== '')) {
      if (draft.trim() === '') {
        if (event.key === 'Enter') event.preventDefault(); // never submit the form from this field
        return;
      }
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 text-sm shadow-xs focus-within:ring-2 focus-within:ring-ring',
        invalid && 'border-destructive',
      )}
    >
      {tags.map((tag) => {
        const valid = normalizeDomain(tag) !== null;
        return (
          <span
            key={tag}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs',
              valid ? 'bg-secondary text-secondary-foreground' : 'bg-destructive/15 text-destructive',
            )}
          >
            {tag}
            <button
              type="button"
              onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
              className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
            <input type="hidden" name={name} value={tag} />
          </span>
        );
      })}
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (/[\s,]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() !== '' && commit(draft)}
        placeholder={tags.length === 0 ? placeholder : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="min-w-32 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
