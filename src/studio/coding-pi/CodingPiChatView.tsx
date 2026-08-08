import { CodingPiCollabView, type CodingPiCollabViewProps } from './CodingPiCollabView';

/**
 * The Coding tab is the native Hermes host for oh-my-pi collab-web.
 *
 * Keep this compatibility name because ChatPageShell owns the Chat/Coding
 * switch, while the implementation itself lives in CodingPiCollabView.
 */
export type CodingPiChatViewProps = CodingPiCollabViewProps;

export function CodingPiChatView(props: CodingPiChatViewProps) {
  return <CodingPiCollabView {...props} />;
}
