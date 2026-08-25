import { useState } from "react";
import Modal from "./Modal";
import { InfoIcon, CursorClickIcon } from "./Icons";

export default function WidgetInfo({ title, summary, query, tip, hueVar }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="info-btn"
        onClick={() => setOpen(true)}
        aria-label={`About ${title}`}
        title="What is this?"
      >
        <InfoIcon />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} hueVar={hueVar}>
        <div className="modal-section">
          <div className="modal-label">What this shows</div>
          <p>{summary}</p>
        </div>
        {query && (
          <div className="modal-section">
            <div className="modal-label">How it&rsquo;s calculated</div>
            <code className="modal-query">{query}</code>
          </div>
        )}
        {tip && (
          <div className="modal-tip">
            <CursorClickIcon />
            <span>{tip}</span>
          </div>
        )}
      </Modal>
    </>
  );
}
