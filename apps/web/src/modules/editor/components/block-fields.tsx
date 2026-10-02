"use client";

import { BLOCKS_COPY, MEDIA_COPY } from "@/content/pt-BR";
import {
  codePointLength, effectivePixKeyType, EMBED_PROVIDERS, FORM_FIELDS, parseEmbedInput, orderFormFields, PIX_KEY_TYPES, SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, TEXT_MAX_LENGTH, WHATSAPP_MESSAGE_MAX_LENGTH,
  type BlockField, type BlockFieldErrors, type BlockInput, type BlockNotices, type FormField, type PixKeyType, type SocialNetwork,
} from "@/modules/blocks";
import type { UploadedMedia } from "@/modules/media/service";
import { imageSources } from "@/modules/media/url";
import { SelectField, TextAreaField, TextField } from "@/ui";
import type { TextBlockField } from "../draft/state";
import { ImageUploader } from "./image-uploader";

interface BlockFieldsProps {
  blockId: string;
  profileId: string;
  input: BlockInput;
  errors: BlockFieldErrors;
  notices: BlockNotices;
  /** Errors are shown only for fields the person already left (or for loaded content). */
  showError: (field: BlockField) => boolean;
  onEdit: (field: TextBlockField, value: string) => void;
  onEditSocial: (network: SocialNetwork, value: string) => void;
  /** Choices, switches and uploaded images: replaces the whole form value of the block. */
  onSetInput: (input: BlockInput) => void;
  onBlur: (field: BlockField) => void;
  onUploadBusy: (busy: boolean) => void;
  onImageUploaded: (media: UploadedMedia) => void;
}

function CheckboxRow({ id, label, checked, describedBy, onChange }: { id: string; label: string; checked: boolean; describedBy?: string; onChange: (checked: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-3 font-bold">
      <input id={id} className="h-5 w-5 shrink-0" type="checkbox" checked={checked} aria-describedby={describedBy} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Form fields of one block. The first field gets `${blockId}-first` so focus can move to it. */
export function BlockFields({ blockId, profileId, input, errors, notices, showError, onEdit, onEditSocial, onSetInput, onBlur, onUploadBusy, onImageUploaded }: BlockFieldsProps) {
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
    case "image": {
      const hasImage = input.mediaId !== "";
      const imageError = error("image");
      return (
        <div className="grid gap-4">
          <div className="grid gap-2" role="group" aria-labelledby={fieldId("image-label")}>
            <p id={fieldId("image-label")} className="ui-label m-0">{BLOCKS_COPY.fields.imageFile}</p>
            {hasImage ? (
              <picture className="block w-40 max-w-full">
                <img {...imageSources(input.mediaId, input.width)} sizes="160px" className="h-auto w-full rounded-lg border border-app-border" width={input.width} height={input.height} alt={MEDIA_COPY.image.current} />
              </picture>
            ) : null}
            <ImageUploader id={fieldId("upload")} pickId={`${blockId}-first`} profileId={profileId} kind="image" hasImage={hasImage} labels={{ pick: MEDIA_COPY.pick, replace: MEDIA_COPY.replace }} onUploaded={onImageUploaded} onBusyChange={onUploadBusy} />
            {imageError ? <p className="ui-error" role="alert">{imageError}</p> : null}
          </div>
          <TextField id={fieldId("alt")} label={BLOCKS_COPY.fields.imageAlt} hint={BLOCKS_COPY.fields.imageAltHint} value={input.alt} disabled={input.decorative} error={input.decorative ? undefined : error("alt")} maxLength={300} onChange={(event) => onEdit("alt", event.target.value)} onBlur={() => onBlur("alt")} />
          <CheckboxRow id={fieldId("decorative")} label={BLOCKS_COPY.fields.imageDecorative} checked={input.decorative} onChange={(decorative) => onSetInput({ ...input, decorative })} />
        </div>
      );
    }
    case "embed": {
      // Says which provider was recognized as soon as the address is valid, whatever the other fields.
      const parsed = parseEmbedInput(input.url);
      const recognized = parsed.ok ? BLOCKS_COPY.embedRecognized(EMBED_PROVIDERS[parsed.provider].label) : BLOCKS_COPY.fields.embedUrlHint;
      return (
        <div className="grid gap-4">
          <TextField id={`${blockId}-first`} label={BLOCKS_COPY.fields.embedUrl} hint={recognized} value={input.url} error={error("url")} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => onEdit("url", event.target.value)} onBlur={() => onBlur("url")} />
          <TextField id={fieldId("title")} label={BLOCKS_COPY.fields.embedTitle} hint={BLOCKS_COPY.fields.embedTitleHint} value={input.title} error={error("title")} maxLength={120} onChange={(event) => onEdit("title", event.target.value)} onBlur={() => onBlur("title")} />
        </div>
      );
    }
    case "pix": {
      const detected = input.keyType === "auto" ? effectivePixKeyType(input) : null;
      return (
        <div className="grid gap-4">
          <TextField id={`${blockId}-first`} label={BLOCKS_COPY.fields.pixLabel} hint={BLOCKS_COPY.fields.pixLabelHint} value={input.label} error={error("label")} maxLength={120} onChange={(event) => onEdit("label", event.target.value)} onBlur={() => onBlur("label")} />
          <TextField id={fieldId("key")} label={BLOCKS_COPY.fields.pixKey} hint={hint("key", BLOCKS_COPY.fields.pixKeyHint)} value={input.key} error={error("key")} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => onEdit("key", event.target.value)} onBlur={() => onBlur("key")} />
          <SelectField id={fieldId("keyType")} label={BLOCKS_COPY.fields.pixKeyType} value={input.keyType} onChange={(event) => { const next = event.target.value; onSetInput({ ...input, keyType: PIX_KEY_TYPES.find((type): type is PixKeyType => type === next) ?? "auto" }); }}>
            <option value="auto">{detected ? `${BLOCKS_COPY.pixKeyTypeAuto} (${BLOCKS_COPY.pixKeyTypes[detected]})` : BLOCKS_COPY.pixKeyTypeAuto}</option>
            {PIX_KEY_TYPES.map((type) => <option key={type} value={type}>{BLOCKS_COPY.pixKeyTypes[type]}</option>)}
          </SelectField>
          <TextField id={fieldId("paymentUrl")} label={BLOCKS_COPY.fields.pixPaymentUrl} hint={BLOCKS_COPY.fields.pixPaymentUrlHint} value={input.paymentUrl} error={error("paymentUrl")} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => onEdit("paymentUrl", event.target.value)} onBlur={() => onBlur("paymentUrl")} />
        </div>
      );
    }
    case "form": {
      const fieldsError = error("fields");
      const toggle = (field: FormField, checked: boolean) => {
        onSetInput({ ...input, fields: orderFormFields(checked ? [...input.fields, field] : input.fields.filter((item) => item !== field)) });
        onBlur("fields");
      };
      return (
        <div className="grid gap-4">
          <TextField id={`${blockId}-first`} label={BLOCKS_COPY.fields.formTitle} hint={BLOCKS_COPY.fields.formTitleHint} value={input.title} error={error("title")} maxLength={120} onChange={(event) => onEdit("title", event.target.value)} onBlur={() => onBlur("title")} />
          <fieldset className="m-0 grid gap-1 border-0 p-0" aria-describedby={fieldId("fields-hint")}>
            <legend className="ui-label mb-1 p-0">{BLOCKS_COPY.fields.formFields}</legend>
            {FORM_FIELDS.map((field) => <CheckboxRow key={field} id={fieldId(`field-${field}`)} label={BLOCKS_COPY.formFields[field]} checked={input.fields.includes(field)} onChange={(checked) => toggle(field, checked)} />)}
            <p id={fieldId("fields-hint")} className={fieldsError ? "ui-error" : "ui-hint"} role={fieldsError ? "alert" : undefined}>{fieldsError ?? BLOCKS_COPY.fields.formFieldsHint}</p>
          </fieldset>
          <TextField id={fieldId("buttonLabel")} label={BLOCKS_COPY.fields.formButton} value={input.buttonLabel} error={error("buttonLabel")} maxLength={60} onChange={(event) => onEdit("buttonLabel", event.target.value)} onBlur={() => onBlur("buttonLabel")} />
          <TextAreaField id={fieldId("consentText")} label={BLOCKS_COPY.fields.formConsent} hint={BLOCKS_COPY.fields.formConsentHint} value={input.consentText} error={error("consentText")} rows={2} onChange={(event) => onEdit("consentText", event.target.value)} onBlur={() => onBlur("consentText")} />
          <CheckboxRow id={fieldId("consentRequired")} label={BLOCKS_COPY.fields.formConsentRequired} checked={input.consentRequired} onChange={(consentRequired) => onSetInput({ ...input, consentRequired })} />
        </div>
      );
    }
  }
}
