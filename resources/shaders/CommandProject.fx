/*
 * CommandProject Shaders: pós-processamento para Supreme Commander 2.
 * Roda no ReShade (DirectX 9). Não depende de outros pacotes de shaders.
 *
 * Técnicas, na ordem em que devem rodar:
 *   CP_Suavizar  anti-serrilhado por borda (estilo FXAA)
 *   CP_Detalhe   nitidez adaptativa + contraste local ("clareza")
 *   CP_Brilho    bloom suave em espaço linear (cadeia de downsample/upsample)
 *   CP_Cor       exposição, contraste, vibração, temperatura, vinheta e dithering
 *
 * Copyright (c) 2026 RiqueBitt. Licença MIT.
 */

#define CP_PIXEL float2(BUFFER_RCP_WIDTH, BUFFER_RCP_HEIGHT)

// ---------------------------------------------------------------------------------------------
// Ajustes (aparecem no menu do ReShade, tecla Home)
// ---------------------------------------------------------------------------------------------

uniform float AA_Strength <
	ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Suavização"; ui_label = "Intensidade";
	ui_tooltip = "Quanto as bordas serrilhadas são suavizadas.";
> = 0.75;

uniform float AA_Threshold <
	ui_type = "slider"; ui_min = 0.04; ui_max = 0.30; ui_step = 0.01;
	ui_category = "Suavização"; ui_label = "Sensibilidade";
	ui_tooltip = "Menor = suaviza mais bordas (e pode amolecer textos da interface).";
> = 0.10;

uniform float Sharp_Amount <
	ui_type = "slider"; ui_min = 0.0; ui_max = 1.5; ui_step = 0.01;
	ui_category = "Detalhe"; ui_label = "Nitidez";
	ui_tooltip = "Nitidez adaptativa: reforça mais onde a imagem está borrada e menos onde já há contraste.";
> = 0.60;

uniform float Sharp_Limit <
	ui_type = "slider"; ui_min = 0.02; ui_max = 0.30; ui_step = 0.01;
	ui_category = "Detalhe"; ui_label = "Limite da nitidez";
	ui_tooltip = "Evita halos brancos em volta das unidades.";
> = 0.10;

uniform float Clarity_Amount <
	ui_type = "slider"; ui_min = 0.0; ui_max = 1.5; ui_step = 0.01;
	ui_category = "Detalhe"; ui_label = "Clareza (contraste local)";
	ui_tooltip = "Dá relevo ao terreno e às unidades sem escurecer a imagem toda.";
> = 0.40;

uniform float Bloom_Intensity <
	ui_type = "slider"; ui_min = 0.0; ui_max = 1.5; ui_step = 0.01;
	ui_category = "Brilho"; ui_label = "Intensidade";
> = 0.45;

uniform float Bloom_Threshold <
	ui_type = "slider"; ui_min = 0.2; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Brilho"; ui_label = "Limiar";
	ui_tooltip = "Só o que for mais claro que isso brilha (explosões, tiros, luzes).";
> = 0.62;

uniform float Bloom_Knee <
	ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Brilho"; ui_label = "Suavidade do limiar";
> = 0.50;

uniform float3 Bloom_Tint <
	ui_type = "color"; ui_category = "Brilho"; ui_label = "Cor do brilho";
> = float3(1.0, 0.95, 0.88);

uniform float Exposure <
	ui_type = "slider"; ui_min = -1.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Exposição";
> = 0.0;

uniform float Contrast <
	ui_type = "slider"; ui_min = -0.5; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Contraste";
> = 0.20;

uniform float Shadows <
	ui_type = "slider"; ui_min = -0.15; ui_max = 0.15; ui_step = 0.005;
	ui_category = "Cor"; ui_label = "Sombras";
	ui_tooltip = "Positivo clareia as sombras; negativo deixa o preto mais profundo.";
> = -0.02;

uniform float Midtones <
	ui_type = "slider"; ui_min = 0.7; ui_max = 1.4; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Meios-tons (gama)";
> = 1.0;

uniform float Vibrance <
	ui_type = "slider"; ui_min = -1.0; ui_max = 1.5; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Vibração";
	ui_tooltip = "Satura mais as cores apagadas e quase nada as já saturadas (as cores dos times continuam legíveis).";
> = 0.35;

uniform float Saturation <
	ui_type = "slider"; ui_min = -1.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Saturação";
> = 0.0;

uniform float Temperature <
	ui_type = "slider"; ui_min = -1.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Temperatura";
	ui_tooltip = "Negativo esfria (azul), positivo esquenta (laranja).";
> = 0.0;

uniform float Tint <
	ui_type = "slider"; ui_min = -1.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Matiz (verde/magenta)";
> = 0.0;

uniform float Vignette_Amount <
	ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Vinheta";
	ui_tooltip = "Escurece levemente as bordas da tela.";
> = 0.12;

uniform float Vignette_Size <
	ui_type = "slider"; ui_min = 0.3; ui_max = 1.5; ui_step = 0.01;
	ui_category = "Cor"; ui_label = "Tamanho da vinheta";
> = 0.95;

// ---------------------------------------------------------------------------------------------
// Texturas
// ---------------------------------------------------------------------------------------------

texture CP_BackBufferTex : COLOR;
sampler CP_Color { Texture = CP_BackBufferTex; };

texture CP_DetailTexA { Width = BUFFER_WIDTH / 4; Height = BUFFER_HEIGHT / 4; Format = R16F; };
texture CP_DetailTexB { Width = BUFFER_WIDTH / 4; Height = BUFFER_HEIGHT / 4; Format = R16F; };
sampler CP_DetailA { Texture = CP_DetailTexA; };
sampler CP_DetailB { Texture = CP_DetailTexB; };

texture CP_BloomTex1 { Width = BUFFER_WIDTH / 2;  Height = BUFFER_HEIGHT / 2;  Format = RGBA16F; };
texture CP_BloomTex2 { Width = BUFFER_WIDTH / 4;  Height = BUFFER_HEIGHT / 4;  Format = RGBA16F; };
texture CP_BloomTex3 { Width = BUFFER_WIDTH / 8;  Height = BUFFER_HEIGHT / 8;  Format = RGBA16F; };
texture CP_BloomTex4 { Width = BUFFER_WIDTH / 16; Height = BUFFER_HEIGHT / 16; Format = RGBA16F; };
texture CP_BloomTex5 { Width = BUFFER_WIDTH / 32; Height = BUFFER_HEIGHT / 32; Format = RGBA16F; };
texture CP_UpTex4    { Width = BUFFER_WIDTH / 16; Height = BUFFER_HEIGHT / 16; Format = RGBA16F; };
texture CP_UpTex3    { Width = BUFFER_WIDTH / 8;  Height = BUFFER_HEIGHT / 8;  Format = RGBA16F; };
texture CP_UpTex2    { Width = BUFFER_WIDTH / 4;  Height = BUFFER_HEIGHT / 4;  Format = RGBA16F; };
texture CP_UpTex1    { Width = BUFFER_WIDTH / 2;  Height = BUFFER_HEIGHT / 2;  Format = RGBA16F; };
sampler CP_Bloom1 { Texture = CP_BloomTex1; };
sampler CP_Bloom2 { Texture = CP_BloomTex2; };
sampler CP_Bloom3 { Texture = CP_BloomTex3; };
sampler CP_Bloom4 { Texture = CP_BloomTex4; };
sampler CP_Bloom5 { Texture = CP_BloomTex5; };
sampler CP_Up4 { Texture = CP_UpTex4; };
sampler CP_Up3 { Texture = CP_UpTex3; };
sampler CP_Up2 { Texture = CP_UpTex2; };
sampler CP_Up1 { Texture = CP_UpTex1; };

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

float CP_Luma(float3 c)
{
	return dot(c, float3(0.2126, 0.7152, 0.0722));
}

// Triângulo que cobre a tela inteira (3 vértices, sem buffer).
void CP_VS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 uv : TEXCOORD)
{
	uv.x = (id == 2) ? 2.0 : 0.0;
	uv.y = (id == 1) ? 2.0 : 0.0;
	position = float4(uv * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

// ---------------------------------------------------------------------------------------------
// CP_Suavizar: anti-serrilhado guiado pela direção da borda
// ---------------------------------------------------------------------------------------------

float3 CP_AA_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = CP_PIXEL;
	float3 rgbM = tex2D(CP_Color, uv).rgb;

	// amostras no canto dos pixels: o filtro bilinear já faz a média de 2x2
	float lumaNW = CP_Luma(tex2D(CP_Color, uv + float2(-0.5, -0.5) * px).rgb);
	float lumaNE = CP_Luma(tex2D(CP_Color, uv + float2( 0.5, -0.5) * px).rgb);
	float lumaSW = CP_Luma(tex2D(CP_Color, uv + float2(-0.5,  0.5) * px).rgb);
	float lumaSE = CP_Luma(tex2D(CP_Color, uv + float2( 0.5,  0.5) * px).rgb);
	float lumaM = CP_Luma(rgbM);

	float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
	float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
	if (lumaMax - lumaMin < max(0.03, lumaMax * AA_Threshold))
		return rgbM;

	float2 dir;
	dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
	dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
	float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * 0.125), 1.0 / 128.0);
	float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
	dir = clamp(dir * rcpDirMin, -8.0, 8.0) * px;

	float3 rgbA = 0.5 * (tex2D(CP_Color, uv + dir * (1.0 / 3.0 - 0.5)).rgb +
	                     tex2D(CP_Color, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
	float3 rgbB = rgbA * 0.5 + 0.25 * (tex2D(CP_Color, uv - dir * 0.5).rgb +
	                                   tex2D(CP_Color, uv + dir * 0.5).rgb);
	float lumaB = CP_Luma(rgbB);
	float3 smoothed = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
	return lerp(rgbM, smoothed, AA_Strength);
}

// ---------------------------------------------------------------------------------------------
// CP_Detalhe: nitidez adaptativa + contraste local
// ---------------------------------------------------------------------------------------------

// luminância média de blocos 4x4 (4 amostras bilineares)
float CP_DetailDown_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = CP_PIXEL;
	float3 c = tex2D(CP_Color, uv + float2(-1.0, -1.0) * px).rgb
	         + tex2D(CP_Color, uv + float2( 1.0, -1.0) * px).rgb
	         + tex2D(CP_Color, uv + float2(-1.0,  1.0) * px).rgb
	         + tex2D(CP_Color, uv + float2( 1.0,  1.0) * px).rgb;
	return CP_Luma(c * 0.25);
}

// gaussiana de 9 amostras feita com 5 leituras bilineares
float CP_Gauss(sampler s, float2 uv, float2 step)
{
	float sum = tex2D(s, uv).r * 0.2270270270;
	sum += (tex2D(s, uv + step * 1.3846153846).r + tex2D(s, uv - step * 1.3846153846).r) * 0.3162162162;
	sum += (tex2D(s, uv + step * 3.2307692308).r + tex2D(s, uv - step * 3.2307692308).r) * 0.0702702703;
	return sum;
}

float CP_DetailBlurH_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	return CP_Gauss(CP_DetailA, uv, float2(4.0 * BUFFER_RCP_WIDTH, 0.0));
}

float CP_DetailBlurV_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	return CP_Gauss(CP_DetailB, uv, float2(0.0, 4.0 * BUFFER_RCP_HEIGHT));
}

float3 CP_Detail_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = CP_PIXEL;
	float3 c = tex2D(CP_Color, uv).rgb;
	float3 n = tex2D(CP_Color, uv + float2(0.0, -px.y)).rgb;
	float3 s = tex2D(CP_Color, uv + float2(0.0,  px.y)).rgb;
	float3 e = tex2D(CP_Color, uv + float2( px.x, 0.0)).rgb;
	float3 w = tex2D(CP_Color, uv + float2(-px.x, 0.0)).rgb;

	float l  = CP_Luma(c);
	float ln = CP_Luma(n), ls = CP_Luma(s), le = CP_Luma(e), lw = CP_Luma(w);
	float lmin = min(l, min(min(ln, ls), min(le, lw)));
	float lmax = max(l, max(max(ln, ls), max(le, lw)));

	// nitidez: menos ganho onde o contraste local já é alto (evita halos e ruído)
	float adapt = sqrt(saturate(min(lmin, 1.0 - lmax) / max(lmax, 1e-4)));
	float highpass = l - (ln + ls + le + lw) * 0.25;
	float sharp = clamp(highpass * Sharp_Amount * 2.0 * adapt, -Sharp_Limit, Sharp_Limit);

	// clareza: diferença entre o pixel e a vizinhança borrada, focada nos meios-tons
	float blurred = tex2D(CP_DetailA, uv).r;
	float midtones = saturate(4.0 * l * (1.0 - l));
	float clarity = clamp(l - blurred, -0.25, 0.25) * Clarity_Amount * midtones;

	return saturate(c + sharp + clarity);
}

// ---------------------------------------------------------------------------------------------
// CP_Brilho: bloom em espaço linear
// ---------------------------------------------------------------------------------------------

float3 CP_ToLinear(float3 c) { return c * c; }

float3 CP_BrightPass(float3 lin)
{
	float br = max(lin.r, max(lin.g, lin.b));
	float threshold = Bloom_Threshold * Bloom_Threshold;
	float knee = threshold * Bloom_Knee + 1e-5;
	float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
	soft = soft * soft / (4.0 * knee);
	return lin * (max(soft, br - threshold) / max(br, 1e-5));
}

float4 CP_BloomPrefilter_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = CP_PIXEL;
	float3 sum = 0.0;
	float wsum = 0.0;
	// média ponderada (Karis) para que pixels isolados muito claros não pisquem
	static const float2 offsets[4] = { float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0), float2(1.0, 1.0) };
	[unroll] for (int i = 0; i < 4; i++)
	{
		float3 c = CP_BrightPass(CP_ToLinear(tex2D(CP_Color, uv + offsets[i] * px).rgb));
		float wgt = 1.0 / (1.0 + CP_Luma(c));
		sum += c * wgt;
		wsum += wgt;
	}
	return float4(sum / wsum, 1.0);
}

float3 CP_Down(sampler s, float2 uv, float2 texel)
{
	float3 sum = tex2D(s, uv).rgb * 4.0;
	sum += tex2D(s, uv + float2(-1.0, -1.0) * texel).rgb;
	sum += tex2D(s, uv + float2( 1.0, -1.0) * texel).rgb;
	sum += tex2D(s, uv + float2(-1.0,  1.0) * texel).rgb;
	sum += tex2D(s, uv + float2( 1.0,  1.0) * texel).rgb;
	return sum * 0.125;
}

float3 CP_Up(sampler s, float2 uv, float2 texel)
{
	float3 sum = tex2D(s, uv + float2(-2.0, 0.0) * texel).rgb;
	sum += tex2D(s, uv + float2( 2.0, 0.0) * texel).rgb;
	sum += tex2D(s, uv + float2(0.0, -2.0) * texel).rgb;
	sum += tex2D(s, uv + float2(0.0,  2.0) * texel).rgb;
	sum += tex2D(s, uv + float2(-1.0, -1.0) * texel).rgb * 2.0;
	sum += tex2D(s, uv + float2( 1.0, -1.0) * texel).rgb * 2.0;
	sum += tex2D(s, uv + float2(-1.0,  1.0) * texel).rgb * 2.0;
	sum += tex2D(s, uv + float2( 1.0,  1.0) * texel).rgb * 2.0;
	return sum / 12.0;
}

float4 CP_BloomDown2_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Down(CP_Bloom1, uv, CP_PIXEL * 2.0), 1.0); }
float4 CP_BloomDown3_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Down(CP_Bloom2, uv, CP_PIXEL * 4.0), 1.0); }
float4 CP_BloomDown4_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Down(CP_Bloom3, uv, CP_PIXEL * 8.0), 1.0); }
float4 CP_BloomDown5_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Down(CP_Bloom4, uv, CP_PIXEL * 16.0), 1.0); }

float4 CP_BloomUp4_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Up(CP_Bloom5, uv, CP_PIXEL * 32.0) + tex2D(CP_Bloom4, uv).rgb, 1.0); }
float4 CP_BloomUp3_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Up(CP_Up4, uv, CP_PIXEL * 16.0) + tex2D(CP_Bloom3, uv).rgb, 1.0); }
float4 CP_BloomUp2_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Up(CP_Up3, uv, CP_PIXEL * 8.0) + tex2D(CP_Bloom2, uv).rgb, 1.0); }
float4 CP_BloomUp1_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target { return float4(CP_Up(CP_Up2, uv, CP_PIXEL * 4.0) + tex2D(CP_Bloom1, uv).rgb, 1.0); }

float3 CP_BloomComposite_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float3 lin = CP_ToLinear(tex2D(CP_Color, uv).rgb);
	float3 bloom = CP_Up(CP_Up1, uv, CP_PIXEL * 2.0) / 5.0; // 5 níveis somados
	lin += bloom * Bloom_Intensity * Bloom_Tint;
	// ombro suave para o brilho não estourar em branco chapado
	lin = lin / (1.0 + max(lin - 1.0, 0.0));
	return sqrt(saturate(lin));
}

// ---------------------------------------------------------------------------------------------
// CP_Cor: correção de cor final
// ---------------------------------------------------------------------------------------------

float3 CP_Grade_PS(float4 vpos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float3 c = tex2D(CP_Color, uv).rgb;

	c *= exp2(Exposure);

	// balanço de branco simples que preserva o brilho
	float lumaBefore = CP_Luma(c);
	c *= float3(1.0 + Temperature * 0.10, 1.0 - Tint * 0.08, 1.0 - Temperature * 0.10);
	c *= lumaBefore / max(CP_Luma(c), 1e-5);

	// sombras e meios-tons
	c = c + Shadows * (1.0 - c);
	c = pow(saturate(c), 1.0 / Midtones);

	// contraste em curva S (não corta pretos nem brancos)
	float3 s = c * c * (3.0 - 2.0 * c);
	c = saturate(lerp(c, s, Contrast));

	// vibração e saturação
	float l = CP_Luma(c);
	float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
	c = lerp(l, c, 1.0 + Vibrance * (1.0 - sat));
	c = lerp(CP_Luma(c), c, 1.0 + Saturation);

	// vinheta
	float2 d = (uv - 0.5) * float2(BUFFER_WIDTH * BUFFER_RCP_HEIGHT, 1.0);
	float v = smoothstep(Vignette_Size * 0.45, Vignette_Size * 1.15, length(d));
	c *= 1.0 - Vignette_Amount * v;

	// dithering leve para não criar faixas em degradês (saída de 8 bits)
	float noise = frac(sin(dot(vpos.xy, float2(12.9898, 78.233))) * 43758.5453);
	c += (noise - 0.5) / 255.0;

	return saturate(c);
}

// ---------------------------------------------------------------------------------------------
// Técnicas
// ---------------------------------------------------------------------------------------------

technique CP_Suavizar <
	ui_label = "CP: Suavização";
	ui_tooltip = "Anti-serrilhado leve pelas bordas. Rode antes das outras.";
>
{
	pass { VertexShader = CP_VS; PixelShader = CP_AA_PS; }
}

technique CP_Detalhe <
	ui_label = "CP: Detalhe";
	ui_tooltip = "Nitidez adaptativa e contraste local.";
>
{
	pass Down  { VertexShader = CP_VS; PixelShader = CP_DetailDown_PS;  RenderTarget = CP_DetailTexA; }
	pass BlurH { VertexShader = CP_VS; PixelShader = CP_DetailBlurH_PS; RenderTarget = CP_DetailTexB; }
	pass BlurV { VertexShader = CP_VS; PixelShader = CP_DetailBlurV_PS; RenderTarget = CP_DetailTexA; }
	pass Apply { VertexShader = CP_VS; PixelShader = CP_Detail_PS; }
}

technique CP_Brilho <
	ui_label = "CP: Brilho";
	ui_tooltip = "Bloom suave em explosões, tiros e luzes.";
>
{
	pass Prefilter { VertexShader = CP_VS; PixelShader = CP_BloomPrefilter_PS; RenderTarget = CP_BloomTex1; }
	pass Down2 { VertexShader = CP_VS; PixelShader = CP_BloomDown2_PS; RenderTarget = CP_BloomTex2; }
	pass Down3 { VertexShader = CP_VS; PixelShader = CP_BloomDown3_PS; RenderTarget = CP_BloomTex3; }
	pass Down4 { VertexShader = CP_VS; PixelShader = CP_BloomDown4_PS; RenderTarget = CP_BloomTex4; }
	pass Down5 { VertexShader = CP_VS; PixelShader = CP_BloomDown5_PS; RenderTarget = CP_BloomTex5; }
	pass Up4 { VertexShader = CP_VS; PixelShader = CP_BloomUp4_PS; RenderTarget = CP_UpTex4; }
	pass Up3 { VertexShader = CP_VS; PixelShader = CP_BloomUp3_PS; RenderTarget = CP_UpTex3; }
	pass Up2 { VertexShader = CP_VS; PixelShader = CP_BloomUp2_PS; RenderTarget = CP_UpTex2; }
	pass Up1 { VertexShader = CP_VS; PixelShader = CP_BloomUp1_PS; RenderTarget = CP_UpTex1; }
	pass Composite { VertexShader = CP_VS; PixelShader = CP_BloomComposite_PS; }
}

technique CP_Cor <
	ui_label = "CP: Cor";
	ui_tooltip = "Exposição, contraste, vibração, temperatura e vinheta. Rode por último.";
>
{
	pass { VertexShader = CP_VS; PixelShader = CP_Grade_PS; }
}
