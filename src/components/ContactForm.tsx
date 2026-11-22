import { useState } from 'react';
import { api, useConn } from '../data/api';
import { Icon } from './Icon';

// "Contact us": one form for the website and the app's Help page. A signed-in landlord writes from their account
// (their name and email are known); anyone else gives a name and email. Every message reaches the support inbox
// and the sender gets an email saying we have it.

const TOPICS = [['question', 'A question'], ['billing', 'Plans and billing'], ['bug', 'Something is not working'], ['partnership', 'Working together'], ['other', 'Something else']] as const;

export function ContactForm({ title = 'Contact us', id = 'contact-form' }: { title?: string; id?: string }) {
  const conn = useConn();
  const owner = conn.mode === 'server' && !!conn.user;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<(typeof TOPICS)[number][0]>('question');
  const [message, setMessage] = useState('');
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const ok = message.trim().length >= 2 && (owner || (name.trim() && /\S+@\S+\.\S+/.test(email)));
  const label = TOPICS.find((t) => t[0] === topic)![1];
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ok || state === 'sending') return;
    setState('sending'); setErr('');
    try {
      if (owner) await api('POST', '/api/support/tickets', { subject: `${label}: ${message.trim().replace(/\s+/g, ' ').slice(0, 80)}`.slice(0, 140), message: message.trim(), category: topic === 'billing' || topic === 'bug' ? topic : 'question' });
      else await api('POST', '/api/contact', { name: name.trim(), email: email.trim(), topic, message: message.trim(), website: trap });
      setState('sent');
    } catch (x) { setErr((x as Error).message || 'Could not send. Please try again.'); setState('idle'); }
  };
  if (state === 'sent') return (
    <div className="contact-box" id={id} role="status">
      <h2><Icon name="check" size={20} /> Message sent</h2>
      <p className="soft">Thank you. A person on our team will reply by email, usually within one business day.</p>
      <button className="btn" onClick={() => { setMessage(''); setState('idle'); }}>Send another</button>
    </div>
  );
  return (
    <form className="contact-box contact-form" id={id} onSubmit={send}>
      <h2><Icon name="mail" size={20} /> {title}</h2>
      <p className="small soft">A person on our team reads every message and replies by email.</p>
      {!owner && <div className="grid2">
        <div className="field"><label htmlFor={`${id}-name`}>Your name</label><input id={`${id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></div>
        <div className="field"><label htmlFor={`${id}-email`}>Your email</label><input id={`${id}-email`} type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" /></div>
      </div>}
      <div className="field"><label htmlFor={`${id}-topic`}>What is it about?</label>
        <select id={`${id}-topic`} className="input" value={topic} onChange={(e) => setTopic(e.target.value as typeof topic)}>{TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor={`${id}-message`}>Your message</label><textarea id={`${id}-message`} className="input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} /></div>
      {/* Left empty by people; bots fill it in. */}
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
      {err && <p className="small acct-error" role="alert">{err}</p>}
      <button className="btn primary" disabled={!ok || state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send message'}</button>
    </form>
  );
}
