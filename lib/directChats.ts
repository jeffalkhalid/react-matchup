import { supabase } from './supabase';
import { notifyPlayers } from './notify';

export type DmPrivacy = 'everyone' | 'played' | 'none';
export type DirectStatus = 'pending' | 'accepted' | 'declined';

export interface DirectPlayerInfo {
  name: string;
  avatar_url: string | null;
}

export interface DirectConversation {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: DirectStatus;
  created_at: string;
  last_message_at: string | null;
  requester_last_read: string | null;
  addressee_last_read: string | null;
  // Joined player info (optional — present when fetched with select join)
  requester?: DirectPlayerInfo | null;
  addressee?: DirectPlayerInfo | null;
}

export function otherName(conv: DirectConversation, myId: string): string {
  const side = conv.requester_id === myId ? conv.addressee : conv.requester;
  return side?.name ?? (conv.requester_id === myId ? conv.addressee_id : conv.requester_id).slice(0, 8);
}

export function otherPhoto(conv: DirectConversation, myId: string): string | null {
  const side = conv.requester_id === myId ? conv.addressee : conv.requester;
  return side?.avatar_url ?? null;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  reactions: Record<string, string[]>;
}

export function otherId(conv: DirectConversation, myId: string): string {
  return conv.requester_id === myId ? conv.addressee_id : conv.requester_id;
}

// Une demande reçue = pending dont je suis le destinataire.
export function isRequestFor(conv: DirectConversation, myId: string): boolean {
  return conv.status === 'pending' && conv.addressee_id === myId;
}

// Non-lu indicatif (0/1) : dernier message plus récent que mon dernier read.
export function unreadFor(conv: DirectConversation, myId: string): number {
  const lastRead = conv.requester_id === myId ? conv.requester_last_read : conv.addressee_last_read;
  if (!conv.last_message_at) return 0;
  if (!lastRead) return 1;
  return new Date(conv.last_message_at).getTime() > new Date(lastRead).getTime() ? 1 : 0;
}

export async function fetchConversations(): Promise<DirectConversation[]> {
  const { data, error } = await supabase
    .from('direct_conversations')
    .select('*, requester:players!requester_id(name,avatar_url), addressee:players!addressee_id(name,avatar_url)')
    .neq('status', 'declined')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DirectConversation[];
}

export async function fetchMessages(conversationId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DirectMessage[];
}

export async function startDirectConversation(
  addresseeId: string, content: string, _addresseeName: string, myName: string,
): Promise<DirectConversation> {
  const { data, error } = await supabase.rpc('start_direct_conversation', {
    p_addressee: addresseeId, p_content: content.trim().slice(0, 500),
  });
  if (error) throw error;
  const conv = data as DirectConversation;
  // Notif unique « [Nom] veut t'envoyer un message » (sans le contenu).
  notifyPlayers({
    playerIds: [addresseeId],
    title: `${myName} veut t'envoyer un message`,
    body: 'Touche pour voir la demande',
    data: { type: 'dm_request', conversationId: conv.id },
  });
  return conv;
}

export async function sendDirectMessage(
  conv: DirectConversation, content: string, myName: string,
): Promise<DirectMessage> {
  const { data, error } = await supabase.rpc('send_direct_message', {
    p_conversation: conv.id, p_content: content.trim().slice(0, 500),
  });
  if (error) throw error;
  const msg = data as DirectMessage;
  // Push normal uniquement si la conversation est acceptée.
  if (conv.status === 'accepted') {
    notifyPlayers({
      playerIds: [otherId(conv, msg.sender_id)],
      title: `💬 ${myName}`,
      body: content.length > 60 ? content.slice(0, 57) + '…' : content,
      data: { type: 'dm', conversationId: conv.id },
    });
  }
  return msg;
}

export async function respondDirectRequest(
  conversationId: string, accept: boolean,
): Promise<DirectConversation> {
  const { data, error } = await supabase.rpc('respond_direct_request', {
    p_conversation: conversationId, p_accept: accept,
  });
  if (error) throw error;
  return data as DirectConversation;
}

export async function toggleDirectReaction(messageId: string, emoji: string): Promise<DirectMessage> {
  const { data, error } = await supabase.rpc('toggle_direct_message_reaction', {
    p_message_id: messageId, p_emoji: emoji,
  });
  if (error) throw error;
  return data as DirectMessage;
}

export async function markConversationRead(conv: DirectConversation, _myId: string): Promise<void> {
  await supabase.rpc('mark_direct_read', { p_conversation: conv.id });
}
