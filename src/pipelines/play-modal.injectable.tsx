import { Div, P } from "@k8slens/element-components";
import { WarningIcon } from "@k8slens/icon";
import { PlainButton, PrimaryButton } from "@k8slens/input-components";
import { ModalContainer, ModalContent, ModalFooter, ModalHeader } from "@k8slens/modal-components";
import { getModalInjectableBunch, getModalKind, type ModalProps, useRespondFromModal } from "@k8slens/modal-contracts";

/** Asks before playing a manual job, which starts it on GitLab. */
export const playModalKind = getModalKind<[name: string, version: string], boolean>()("play-manual-job");

const PlayModal = ({ input: [name, version] }: ModalProps<typeof playModalKind>) => {
  const respond = useRespondFromModal(playModalKind);

  return (
    <ModalContainer>
      <ModalHeader icon={<WarningIcon />}>Play manual job</ModalHeader>
      <ModalContent>
        <P>
          Play {name} for {version}? This starts it on GitLab.
        </P>
      </ModalContent>
      <ModalFooter>
        <Div $flex={{ direction: "horizontal", gap: "s" }}>
          <PlainButton onClick={() => respond(false)}>Cancel</PlainButton>
          <PrimaryButton onClick={() => respond(true)}>Play</PrimaryButton>
        </Div>
      </ModalFooter>
    </ModalContainer>
  );
};

export const playModalBunch = getModalInjectableBunch({
  kind: playModalKind,
  Component: PlayModal,
  onClose: () => false,
});
