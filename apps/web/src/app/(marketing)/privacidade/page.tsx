import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT } from "@/lib/product";
import { BRAND_CLASS } from "@/ui/brand-font";

export const metadata: Metadata = {
  title: `Privacidade — versão provisória | ${PRODUCT.codename}`,
  description: "Aviso provisório de privacidade: lista do piloto e contagem de visitas das páginas públicas.",
};

const H2 = "mt-8 text-2xl font-bold";
const P = "mt-3 leading-7";

/**
 * Provisional privacy notice. It must describe what the deployed product actually collects
 * (AGENTS.md §10): the waitlist form and, since Sprint 6, the visit counting on public pages
 * (ADR 0011, docs/DATA_MAP.md). The legal review before external users replaces this text.
 */
export default function PrivacyPage() {
  return (
    <main className={`${BRAND_CLASS} py-8 sm:py-16`}>
      <article className="app-shell max-w-3xl surface-card p-5 sm:p-10">
        <span className="ui-badge ui-badge-warning">Versão provisória — 02/10/2026</span>
        <h1 className="mt-5 text-3xl font-bold sm:text-4xl">Aviso de privacidade</h1>
        <p className="mt-5 leading-7 text-app-muted">
          Este aviso cobre o formulário da lista de espera e a contagem de visitas das páginas públicas criadas com o {PRODUCT.codename}. Ele será revisado antes do piloto externo e não substitui os documentos jurídicos do produto final.
        </p>

        <h2 className={H2}>Lista do piloto: dados e finalidade</h2>
        <p className={P}>
          Coletamos nome, e-mail, WhatsApp opcional e respostas sobre seu contexto profissional para entrar em contato sobre pesquisa, piloto e desenvolvimento do produto. UTM e página de origem podem ser guardados para entender como você chegou até nós.
        </p>
        <h2 className={H2}>Lista do piloto: base e escolha</h2>
        <p className={P}>O envio depende de consentimento marcado por você. Não usamos esses dados para decisões automatizadas nem vendemos a lista.</p>

        <h2 className={H2} id="visitas">Quem visita uma página criada com o {PRODUCT.codename}</h2>
        <p className={P}>
          Para que a pessoa ou empresa dona da página saiba quantas visitas e cliques ela recebeu, registramos quando a página é aberta e quando um botão dela é usado (link, WhatsApp, Pix, redes sociais, vídeo ou música, formulário).
        </p>
        <ul className="mt-3 grid gap-2 pl-5 leading-7">
          <li><b>O que guardamos:</b> o tipo do evento e o bloco usado; a origem da visita só como categoria (por exemplo, &quot;Instagram&quot; ou &quot;Google&quot;); o tipo de aparelho (celular, tablet ou computador); o país; e, quando o link usado tem marcações de campanha (UTM), essas marcações.</li>
          <li><b>O que não guardamos:</b> seu endereço IP, o endereço completo do site de onde você veio, a identificação detalhada do seu navegador ou aparelho, e nenhum cookie ou identificador no seu navegador para esta contagem.</li>
          <li><b>Como evitamos contar a mesma visita duas vezes:</b> calculamos um código a partir do seu endereço IP e do seu navegador, misturado com um segredo nosso. O código muda todo dia, é diferente em cada página e não permite saber quem você é nem acompanhar você de uma página para outra.</li>
          <li><b>Por quanto tempo:</b> os registros detalhados são apagados depois de 7 dias. Depois disso ficam só totais por dia (por exemplo, &quot;12 visitas vindas do Instagram&quot;), por até 100 dias.</li>
          <li><b>Quem usa:</b> a dona ou o dono da página e as pessoas que ela ou ele convidou para a conta veem apenas os totais. Quem administra a página também pode criar um link de relatório, com prazo de validade, para mostrar esses totais a outra pessoa (por exemplo, o cliente de uma agência); o relatório mostra só totais e nunca identifica visitantes. Não vendemos esses dados nem os usamos para publicidade.</li>
        </ul>
        <p className={P}>
          Quem bloqueia scripts no navegador não é contado, e a página funciona normalmente. O que você escreve num formulário de uma página é enviado a quem criou a página, que é responsável pelo uso desses dados; vídeos e músicas de YouTube, Vimeo e Spotify só são carregados depois do seu toque, e a partir daí o serviço escolhido recebe dados da sua visita.
        </p>

        <h2 className={H2}>Retenção e operadores</h2>
        <p className={P}>
          A proposta inicial é manter o cadastro da lista durante a pesquisa e o piloto, com revisão em até 12 meses. Hospedagem e banco de dados poderão operar dados em infraestrutura internacional; contratos e fornecedores serão formalizados antes do beta pago.
        </p>
        <h2 className={H2}>Seus direitos</h2>
        <p className={P}>
          Você poderá pedir confirmação, correção ou exclusão pelo canal oficial que será publicado antes da coleta externa. Enquanto o canal não estiver definido, a lista não deve ser usada em produção. Para a contagem de visitas, não conseguimos localizar os registros de uma pessoa específica, porque não guardamos nada que a identifique; os registros detalhados deixam de existir em 7 dias.
        </p>
        <Link className="ui-button ui-button-secondary mt-8" href="/">Voltar para a página inicial</Link>
      </article>
    </main>
  );
}
