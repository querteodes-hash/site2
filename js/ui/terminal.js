// Easter-egg terminal. Commands call back into the app via `api`.

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Terminal {
  constructor({ root, out, form, input, api }) {
    this.root = root; this.out = out; this.form = form; this.input = input; this.api = api;
    this.history = [];
    this.hi = 0;
    this.open = false;
    this.started = performance.now();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      input.value = '';
      if (!v) return;
      this.history.push(v); this.hi = this.history.length;
      this.print(`<span class="g">$</span> ${esc(v)}`);
      this.run(v);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { this.hi = Math.max(0, this.hi - 1); input.value = this.history[this.hi] || ''; e.preventDefault(); }
      if (e.key === 'ArrowDown') { this.hi = Math.min(this.history.length, this.hi + 1); input.value = this.history[this.hi] || ''; e.preventDefault(); }
      if (e.key === 'Escape') this.toggle(false);
      e.stopPropagation();
    });
    this.print('<span class="y">BBB/OS</span> terminal · введи <span class="c">help</span>');
  }

  print(html) {
    const line = document.createElement('div');
    line.innerHTML = html;
    this.out.appendChild(line);
    this.out.scrollTop = this.out.scrollHeight;
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.root.classList.toggle('is-open', this.open);
    this.root.setAttribute('aria-hidden', String(!this.open));
    if (this.open) setTimeout(() => this.input.focus(), 50);
    else this.input.blur();
    this.api.onToggle?.(this.open);
  }

  run(raw) {
    const [cmd, ...args] = raw.split(/\s+/);
    const a = this.api;
    const c = cmd.toLowerCase();
    const go = (id) => { a.goto(id); this.print(`<span class="m">→ /${id}</span>`); };
    switch (c) {
      case 'help':
        this.print([
          '<span class="c">whoami</span>      кто здесь',
          '<span class="c">about · skills · vpn · works · garage · contact</span>  — перейти',
          '<span class="c">ignite</span>      сжечь все купюры на экране',
          '<span class="c">vroom</span>       в гараж и завести M4',
          '<span class="c">sound on|off</span>',
          '<span class="c">neofetch · ping · date · uptime · clear · exit</span>',
        ].join('\n'));
        break;
      case 'whoami':
        this.print('bbb — <span class="y">coder</span> / <span class="y">pentester</span> / <span class="y">full-stack</span> / <span class="y">network engineer</span>');
        break;
      case 'about': go('about'); break;
      case 'skills': case 'arsenal': go('arsenal'); break;
      case 'vpn': case 'obscure': go('vpn'); break;
      case 'works': case 'projects': go('works'); break;
      case 'garage': case 'm4': case 'bmw': go('garage'); break;
      case 'contact': case 'hire': go('contact'); break;
      case 'ignite': case 'burn':
        a.ignite();
        this.print('<span class="y">🔥 горит.</span> деньги — это просто бумага.');
        break;
      case 'vroom': case 'start':
        a.vroom();
        this.print('<span class="r">S58B30T0</span> · 3.0 I6 biturbo · 550 hp · <span class="g">ignition</span>');
        break;
      case 'sound':
        a.sound(args[0] !== 'off');
        this.print(`sound: ${args[0] === 'off' ? 'off' : 'on'}`);
        break;
      case 'neofetch':
        this.print([
          '<span class="y">   ██████   </span>  <span class="c">bbb</span>@portfolio',
          '<span class="y">   ██  ██   </span>  ------------',
          '<span class="y">   █████    </span>  OS: BBB/OS v26.10',
          '<span class="y">   ██  ██   </span>  Shell: zsh · tmux',
          '<span class="y">   ██████   </span>  Stack: Go · Rust · TS · Python',
          '               Net: WireGuard · MikroTik',
          `               Car: ${a.carName?.() || 'BMW M4 CSL'}`,
          `               Uptime: ${Math.round((performance.now() - this.started) / 1000)}s`,
        ].join('\n'));
        break;
      case 'ping': {
        const host = args[0] || 'fra-01.bbb';
        const ms = () => (18 + Math.random() * 9).toFixed(1);
        this.print(`PING ${esc(host)}: 56 data bytes\n64 bytes: icmp_seq=0 time=${ms()} ms\n64 bytes: icmp_seq=1 time=${ms()} ms\n64 bytes: icmp_seq=2 time=${ms()} ms\n<span class="g">--- 0.0% packet loss ---</span>`);
        break;
      }
      case 'date': this.print(new Date().toString()); break;
      case 'uptime': this.print(`up ${Math.round((performance.now() - this.started) / 1000)}s, load average: 0.07, 0.03, 0.01`); break;
      case 'ls': this.print('about.md  arsenal/  vpn/  works/  garage/  secrets.txt'); break;
      case 'cat':
        this.print(args[0] === 'secrets.txt' ? '<span class="r">cat: secrets.txt: Permission denied</span>' : `cat: ${esc(args[0] || '')}: No such file`);
        break;
      case 'sudo': this.print('<span class="r">nice try.</span> этот инцидент будет записан.'); break;
      case 'hack': this.print('только по договору и в рамках scope 😉'); break;
      case 'clear': this.out.innerHTML = ''; break;
      case 'exit': this.toggle(false); break;
      default: this.print(`<span class="r">command not found:</span> ${esc(cmd)} · попробуй <span class="c">help</span>`);
    }
  }
}
