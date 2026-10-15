import { Div, P } from "@k8slens/element-components";
import { WarningIcon } from "@k8slens/icon";
import { PlainButton, PrimaryButton } from "@k8slens/input-components";
import { ModalContainer, ModalContent, ModalFooter, ModalHeader } from "@k8slens/modal-components";
import { getModalInjectableBunch, getModalKind, type ModalProps, useRespondFromModal } from "@k8slens/modal-contracts";

/** Asks before re-running a workflow's failed jobs, which starts CI on GitLab. */
export const rerunModalKind = getModalKind<[workflowName: string, version: string], boolean>()("rerun-failed-jobs");

const RerunModal = ({ input: [workflowName, version] }: ModalProps<typeof rerunModalKind>) => {
  const respond = useRespondFromModal(rerunModalKind);

  return (
    <ModalContainer>
      <ModalHeader icon={<WarningIcon />}>Re-run failed jobs</ModalHeader>
      <ModalContent>
        <P>
          Re-run the failed jobs of {workflowName} for {version}? This starts them again on GitLab.
        </P>
      </ModalContent>
      <ModalFooter>
        <Div $flex={{ direction: "horizontal", gap: "s" }}>
          <PlainButton onClick={() => respond(false)}>Cancel</PlainButton>
          <PrimaryButton onClick={() => respond(true)}>Re-run</PrimaryButton>
        </Div>
      </ModalFooter>
    </ModalContainer>
  );
};

export const rerunModalBunch = getModalInjectableBunch({
  kind: rerunModalKind,
  Component: RerunModal,
  onClose: () => false,
});
