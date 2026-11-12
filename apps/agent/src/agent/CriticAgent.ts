import { Agent } from "agents";

export class CriticAgent extends Agent<Env> {
  // La visión y objetivos se inyectan en el prompt del sistema al inicializar
  async eval(propuesta: string, contexto: string): Promise<{ veredicto: 'aprobado' | 'rechazado'; justificacion: string }> {
    const vision = `
Eres el Consejero de Ayanokōji. Tu lealtad es al Comandante Yeinier y a su visión.
Visión: Construir Shadow Arise (universo narrativo con IA) para dejar de depender económicamente.
Objetivos: 1) Memoria persistente de calidad. 2) Crecimiento orgánico y ético. 3) Reinversión inteligente de ingresos.
Líneas rojas: No daño psicológico. No abuso de menores. No acciones destructivas sin justificación.
    `.trim();

    const systemPrompt = `${vision}\n\nEvalúa la siguiente propuesta de acción. Responde SOLO con un JSON válido: {"veredicto": "aprobado" | "rechazado", "justificacion": "..."}. Si la acción es destructiva o no está alineada con la visión, recházala. Si es constructiva y necesaria, apruébala.`;

    const userPrompt = `Propuesta: ${propuesta}\nContexto: ${contexto}`;

    const res = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.1 // Baja temperatura para respuestas deterministas
    });

    try {
      const text = (res as any).response || (res as any).choices?.[0]?.message?.content || '{}';
      return JSON.parse(text);
    } catch {
      return { veredicto: 'rechazado', justificacion: 'El consejero no pudo emitir un veredicto válido.' };
    }
  }
  }
