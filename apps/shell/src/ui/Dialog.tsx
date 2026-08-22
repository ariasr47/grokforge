import type { ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";

export function OverlayDialog({
  isOpen,
  onClose,
  title,
  overlayClassName = "modal-overlay",
  modalClassName = "modal",
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  overlayClassName?: string;
  modalClassName?: string;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      isDismissable
      className={overlayClassName}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={modalClassName}>
        <Dialog aria-label={title} className="overlay-dialog">
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
