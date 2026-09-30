"use client";

import { BLOCKS_COPY } from "@/content/pt-BR";
import { codePointLength, SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, TEXT_MAX_LENGTH, WHATSAPP_MESSAGE_MAX_LENGTH, type BlockField, type BlockFieldErrors, type BlockInput, type BlockNotices, type SocialNetwork } from "@/modules/blocks";
import { TextAreaField, TextField } from "@/ui";
import type { TextBlockField } from "../draft/state";

interface BlockFieldsProps {
  blockId: string;
  input: BlockInput;
  errors: BlockFieldErrors;
  notices: BlockNotices;
  /** Errors are shown only for fields the person already left (or for loaded content). */
  showError: (field: BlockField) => boolean;
  onEdit: (field: TextBlockField, value: string) => void;
  onEditSocial: (network: SocialNetwork, value: string) => void;
  onBlur: (field: BlockField) => void;
}

/** Form fields of one block. The first field gets `${blockId}-first` so focus can move to it. */
export function BlockFields({ blockId, input, errors, notices, showError, onEdit, onEditSocial, onBlur }: BlockFieldsProps) {
  const fieldId = (field: string) => `${blockId}-${field}`;
  const error = (field: BlockField) => (showError(field) ? errors[field] : undefined);
  const hint = (field: BlockField, fallback?: string) => notices[field] ?? fallback;

  switch (input.type) {
    case "link":
      return (
        <div className="grid gap-4">
          <TextField id={`${blockId}-first`} label={BLOCKS_COPY.fields.linkTitle} hint={BLOCKS_COPY.fields.linkTitleHint} value={input.title} error={error("title")} maxLength={120} onChange={(event) => onEdit("title", event.target.value)} onBlur={() => onBlur("title")} />
          <TextField id={fieldId("url")} label={BLOCKS_COPY.fields.linkUrl} hint={hint("url", BLOCKS_COPY.fields.linkUrlHint)} value={input.url} error={error("url")} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => onEdit("url", event.target.value)} onBlur={() => onBlur("url")} />
        </div>
      );
    case "text":
      return (
        <TextAreaField id={`${blockId}-first`} label={BLOCKS_COPY.fields.text} hint={BLOCKS_COPY.fields.textHint(Math.max(0, TEXT_MAX_LENGTH - codePointLength(input.text)))} value={input.text} error={error("text")} rows={4} onChange={(event) => onEdit("text", event.target.value)} onBlur={() => onBlur("text")} />
      );
    case "whatsapp":
      return (
        <div className="grid gap-4">
          <TextField id={`${blockId}-first`} label={BLOCKS_COPY.fields.whatsappLabel} hint={BLOCKS_COPY.fields.whatsappLabelHint} value={input.label} error={error("label")} maxLength={120} onChange={(event) => onEdit("label", event.target.value)} onBlur={() => onBlur("label")} />
          <TextField id={fieldId("phone")} label={BLOCKS_COPY.fields.whatsappPhone} hint={BLOCKS_COPY.fields.whatsappPhoneHint} value={input.phone} error={error("phone")} type="tel" inputMode="tel" autoComplete="tel" onChange={(event) => onEdit("phone", event.target.value)} onBlur={() => onBlur("phone")} />
          <TextAreaField id={fieldId("message")} label={BLOCKS_COPY.fields.whatsappMessage} hint={BLOCKS_COPY.fields.whatsappMessageHint(Math.max(0, WHATSAPP_MESSAGE_MAX_LENGTH - codePointLength(input.message)))} value={input.message} error={error("message")} rows={3} onChange={(event) => onEdit("message", event.target.value)} onBlur={() => onBlur("message")} />
        </div>
      );
    case "social":
      return (
        <fieldset className="m-0 grid gap-4 border-0 p-0">
          <legend className="mb-3 p-0 text-sm text-app-muted">{BLOCKS_COPY.fields.socialLead}</legend>
          {SOCIAL_NETWORK_IDS.map((network, index) => (
            <TextField
              key={network}
              id={index === 0 ? `${blockId}-first` : fieldId(network)}
              label={SOCIAL_NETWORKS[network].label}
              placeholder={BLOCKS_COPY.fields.socialPlaceholder}
              value={input.items[network] ?? ""}
              error={error(network)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => onEditSocial(network, event.target.value)}
              onBlur={() => onBlur(network)}
            />
          ))}
        </fieldset>
      );
    case "divider":
      return <p id={`${blockId}-first`} tabIndex={-1} className="m-0 text-app-muted">{BLOCKS_COPY.fields.dividerLead}</p>;
  }
}
