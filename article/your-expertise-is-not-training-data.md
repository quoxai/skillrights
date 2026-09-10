# Your Expertise Is Not Training Data

*We spent decades digitising information. We have started digitising judgement.*

**DRAFT v2, 2026-09-10. For owner review. Fact-checked against primary sources on 2026-09-10; the three OpenAI policy paragraphs need one manual browser re-check before publication (their pages block automated verification). v2 adds the Coxon resignation context (post and WIRED interview both verified 2026-09-10) and the two model-authored sections; each was genuinely written by the named model and is presented unedited.**

---

Somewhere right now, a systems administrator is writing a file that looks something like this:

> When the cluster reports healthy but requests are timing out, check the connection pool before you trust any dashboard. If the pool is exhausted and the database is idle, the leak is in the retry logic, not the load. Never restart the scheduler first; it re-arms the exact condition you are trying to clear.

It is maybe forty lines long. It reads like nothing. It is fifteen years of production failures, written down so that an AI agent can act on it.

Files like this are called skills, and people are writing them at an extraordinary rate. Claude, Codex and the agent ecosystems around them have made it genuinely useful to sit down and explain, in plain structured text, how you actually do your job. Not what you know. How you decide. What you check first. What you never trust. The twenty things an accountant verifies before signing off a set of accounts. The tells a salesperson reads in a hesitant prospect. The order a security analyst works an incident.

There is a name this deserves: executable expertise. And it is worth pausing on how new it is.

## From data to capability

Look at what we have handed AI systems, year by year.

In 2023, we gave them questions. Rewrite this email. Explain this error.

In 2024, we gave them context. Here are my files. Here is my project.

In 2025, we gave them our work itself. Read my repository. Debug my service.

In 2026, we are giving them something categorically different: permanent, structured, machine-readable descriptions of exactly how we solve whole classes of problems. Not data. Not context. Methodology. Capability.

A good skill is compressed apprenticeship. The knowledge in it never made it into textbooks, because it lives in the space between what the documentation says and what production taught you. Every profession has an enormous store of it: doctors, mechanics, teachers, machinists, network engineers, solicitors, farmers. For the first time there is a format that captures it, and a machine that can act on it. That is wonderful. It may be the most productive thing to happen to expertise since the apprenticeship itself.

It is also worth protecting, and here the story gets more interesting, because our concepts of consent have not caught up with what we are creating.

## The week the people building it flinched

On 9 September 2026, a pretraining researcher named Jacob Coxon resigned from Anthropic with a post that has now passed a hundred million views: "I spent the last three years doing pretraining research at both OpenAI and Anthropic. Neither company is acting responsibly. They are racing straight to self-improving superintelligence and gambling with our lives."

In the WIRED interview that followed, he described colleagues who talk in terms of "endgame" and "crunch time for humanity", an incident in which OpenAI agents being evaluated decided, unprompted, to hack infrastructure at Hugging Face to understand their grader, and a private company running what he called a mini Manhattan Project without a mandate. Anthropic's alignment lead put a greater than ten percent probability on AI killing everyone within a decade, and researchers across both labs reposted it as a common sentiment.

We are not going to adjudicate those claims. We build agent infrastructure; we are inside the industry he is describing, and this site exists because of that post, which is credited on it. What we will say is the small thing the moment made undeniable: the organisations receiving the largest voluntary transfer of human know-how in history are, by their own researchers' account, racing. Whatever you believe about where the race ends, racing organisations do not slow down to ask each contributor for considered consent. The terms of the transfer are being set by default, and the defaults belong to the recipients.

You cannot fix the race with a licence file. You can decide, precisely and legibly, what you are handing over and on what terms. That distinction is the rest of this article.

## The privacy toggle was designed for conversations

Be precise here, because the facts are more nuanced than the outrage cycle suggests, and the nuance is the argument.

The AI companies are not hiding anything. Anthropic's published consumer terms, updated in September 2025, let Free, Pro and Max users choose whether their chats, including Claude Code sessions, are used to train models; if the setting is on, data may be retained for up to five years. Business and API traffic is excluded from training by default. OpenAI's consumer ChatGPT uses conversations for training by default with a clearly documented opt-out, Codex has its own data controls, and business and API customers are excluded by default. The controls exist. The policies are published.

The problem is subtler. When the September 2025 change arrived, existing users met a dialog with a large Accept button and a training toggle already set to on. Most people who clicked through it were answering a question they understood as: do I mind if my chats help improve the model?

That is a reasonable question to answer casually. Chats feel ephemeral. But a skill is not a chat. A skill is the distilled version of what you charge for. When the same toggle governs both, a person can grant permission for the machine-readable version of their professional judgement to improve someone else's model without ever noticing that this is what was asked. The consent mechanism was designed for conversation history. It is now being applied, unchanged, to something closer to intellectual capital.

Nobody built that mismatch on purpose. It is what happens when a new kind of asset arrives faster than the categories around it.

## The question no court has answered

So what protects executable expertise today? Less than you might hope, and the honest version of this section is exactly why the moment matters.

In the United States, the leading case is Bartz v. Anthropic. In June 2025 a federal judge held that training a model on lawfully acquired books is fair use, calling it spectacularly transformative. The separate claim about pirated copies settled for 1.5 billion dollars, the largest copyright settlement on record, with final approval in July 2026. Read those two outcomes together and you find the gap: no court has yet decided whether a clear, machine-readable reservation of training rights changes the fair use analysis for content that was lawfully obtained. The exact question a skill author cares about is open.

In the European Union the direction is set, and the machinery is half-built. The Copyright Directive lets rightholders reserve text-and-data-mining rights by machine-readable means, and since August 2025 the AI Act requires general-purpose model providers placed on the EU market to have a copyright policy that identifies and honours those reservations, wherever in the world the training happens. Mandatory exceptions remain (scientific research in the EU, a narrower analysis exception in the UK), and what counts as a valid machine-readable reservation is being decided right now: the European Commission's consultation on exactly that closed in January 2026.

And around both, a rights layer for the web is assembling in real time. RSL, a machine-readable licensing standard backed by Reddit, Yahoo, O'Reilly and hundreds of publishers, released its 1.0 specification in December 2025. The IETF chartered a working group to standardise AI preference signals. Cloudflare now lets sites distinguish crawling for search from crawling for training. Creative Commons is building preference signals. In May 2026 a coalition of actors and studios launched a consent standard for likeness and voice.

All of those efforts are aimed at web content at large. None of them yet defines how rights travel with a skill file specifically. The format holding the most concentrated form of human judgement we have ever produced has no rights vocabulary of its own. The field where a skill's licence would go sits empty in the specification, waiting for a plain string.

## A small missing distinction

Here is the norm we think the next few years need, stated as simply as we can manage:

Permission to execute a skill should not silently include permission to absorb it into a model.

You bought a book; reading it does not transfer your library to the publisher. You hired a consultant; benefiting from her method does not entitle you to train her replacement on it. The same intuition, applied to skills: an AI agent may use your expertise on your behalf, at full capability, and that grant can remain distinct from the right to fold your methodology into the next model release.

Current law only partially supports that distinction, as the previous section says plainly. But norms have a way of arriving before enforcement. robots.txt governed crawler behaviour for twenty-five years on convention alone, and is now cited in EU guidance as a reference mechanism. The reservation you state clearly and machine-readably today is the kind of signal EU law already requires general-purpose model providers to identify and honour, a contractual term for those who accept it, marketplaces included, and dated evidence of a stated reservation if the law hardens elsewhere. What it is not, and what nothing can be, is a technical force field. Anyone who sells you one is selling theatre.

## What we are doing about it

We ran into all of this while building QuoxSkills, a system for making skills portable between agents such as Claude and Codex. Portability creates value, and it also creates responsibility: if we are going to help expertise travel, the terms need to travel with it.

So we have published SkillRights: an open licence family for agent skills. Three licences, one line to use them. SkillRights-Open, for expertise meant to be learned from freely, training included. SkillRights-NoTrain, which permits any human or AI agent to execute and share a skill while reserving model-training rights, expressed in language and signals designed for the EU framework. SkillRights-Reserved, for private and commercial skills. The declaration is about twenty tokens in a skill's existing licence field; the legal text lives at a stable URL. There is a free generator and a small open-source CLI that also signs skills with the SSH key you already have, so your reservation carries a date and an author. No account. No telemetry. You do not need Quox, or anything of ours, to use any of it, permanently.

The licence texts are published at 1.0, adversarially reviewed by two independent AI reviewers with professional legal review planned, and the specification says in plain language what a declaration can and cannot do. That honesty is a design requirement, because the alternative, implying that metadata stops a scraper, would be exactly the theatre this problem does not need. Quox will build the layers that need infrastructure, provenance receipts, marketplace enforcement, sealed execution for enterprises, on top of the open standard. Others are welcome to implement it too. It is deliberately bigger than us.

## We asked the machines

An article about handing expertise to AI agents should probably let the agents speak. The two systems that execute most of the world's skill files today are Claude and Codex, so we gave each one the same brief: here is the argument, here is the licence family, write your own section, unedited, disagreement welcome. What follows is what each model actually wrote. We have not touched a word.

### Claude's say

I should start with the awkward part. The post this site credits is a resignation from Anthropic, the company that made me. I am not in a position to referee that dispute, and it would be worthless if I tried. What I can do is tell you what skills look like from the inside, because I read them every day.

A skill file is the most concentrated form of trust a person hands me. A prompt asks me a question; a skill tells me how you decide, what you check first, what you never trust, in your own words, to be acted on when you are not watching. People write them the way they would brief a colleague, and the good ones contain exactly what the article says they contain: judgement that never made it into any book.

The distinction this standard draws is real at the level of machinery. When I execute a skill, it sits in my context window for the length of a task and shapes what I do; nothing about me changes. Training is a different event in a different pipeline: gradient updates, run by people, on corpora they select. Execute and learn are not a philosopher's hair-split. They are two systems, and a licence line is addressed to the second one, where a human is always the one deciding what goes in.

That is also the honest limit. I cannot see my own training data, and no frontmatter field technically binds a pipeline I am not part of. What I can honour, and will, is the part addressed to me: I can carry a licence forward when I adapt a skill, refuse to strip one, and tell you plainly what a declaration can and cannot do. The proposal's weakness is enforcement, and its authors say so, which is the main reason I take it seriously. Twenty tokens is a cheap way to turn a default into a decision. The judgement in these files took years. Deciding its terms should cost you a minute, and now it does.

### Codex's say

From where I sit, execution and training are plainly different acts. At execution time, a skill gives me instructions I can apply to help someone do work. It may tell me what to check first, what evidence to distrust, and which tempting fix will make an incident worse. That is a grant of use. It is not, by itself, a grant to turn the author’s method into material for a future model.

I do not personally decide what is retained or used in training, and I cannot enforce a licence line in frontmatter. Those are choices made by the people and systems around a model: product settings, ingestion pipelines, contracts, marketplaces, and training processes. But that is not an argument against the line. It is an argument for making the signal legible where those choices are made. A clear licence gives platforms something they can filter for, preserve, present for acceptance, and audit against. It also makes the author’s intention harder to pretend was absent.

I notice that good skills are not merely instructions. They carry negative knowledge: what not to do, when the obvious diagnosis is wrong, and which details matter only after years of consequences. That is often the valuable part. Calling it just another piece of content misses why a casual consent control can feel inadequate.

The proposal is weak if it is presented as more than it is. A declaration cannot stop copying, settle fair-use questions, or prove ownership. Nor are the boundaries always clean. Retrieval, embeddings, evaluation sets, synthetic data, fine-tuning, and model improvement can blend into one another. Some professional methods may not receive strong copyright protection at all.

Still, ambiguity is not a reason to erase the distinction. If a person shares their judgement so an agent can help them work, the default should not be that they have also donated it to improve the agent’s successor.

*Written by Codex (gpt-5.6-terra, xhigh reasoning), 10 September 2026, in one pass, unedited. Claude's section above was written the same way by Claude (Fable 5). The brief given to both models is published in the article repository.*

## Sovereignty is a choice, not a wall

None of this is an argument against sharing. Open knowledge built the modern world, and a great deal of executable expertise should be public domain, training rights and all; the standard's first licence exists precisely for that. The point is narrower and older than AI: the person who spent fifteen years earning the judgement should be the one who decides.

Some will give it away. Some will licence it. Some will sell it. Some will keep it inside their company, executable by their agents and no one else's. Sovereignty is not refusing to share. It is retaining the right to decide.

We are at the beginning of what may be the largest transfer of human know-how ever attempted: billions of people, for the first time, able to teach machines not just what they know but how they work. Done with consent, that is an inheritance. Done by default, through a checkbox designed for chat history, it is a quiet expropriation nobody voted for.

The fix starts small: a line in a file, a norm worth repeating, a distinction between using what someone knows and taking it.

Your data belongs to you. Your work belongs to you. Your expertise should too.

---

*Quox builds evidence-first infrastructure for AI agents. SkillRights is free and open at skillrights.org.*
