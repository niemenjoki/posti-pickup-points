# posti-pickup-points: Postin noutopisteiden ja pakettiautomaattien haku Node.js:llä

[![npm version](https://img.shields.io/npm/v/@niemenjoki/posti-pickup-points)](https://www.npmjs.com/package/@niemenjoki/posti-pickup-points)
[![npm downloads](https://img.shields.io/npm/dm/@niemenjoki/posti-pickup-points)](https://www.npmjs.com/package/@niemenjoki/posti-pickup-points)
[![tests](https://img.shields.io/github/actions/workflow/status/niemenjoki/posti-pickup-points/test.yml?branch=main&label=tests)](https://github.com/niemenjoki/posti-pickup-points/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@niemenjoki/posti-pickup-points)](LICENSE)
[![node](https://img.shields.io/node/v/@niemenjoki/posti-pickup-points)](package.json)

[English](https://github.com/niemenjoki/posti-pickup-points/blob/main/README.md) | Suomi

Hakee Postin noutopisteet ja pakettiautomaatit suomalaisen postinumeron läheltä, esimerkiksi verkkokaupan kassan
toimitustavoiksi. Käyttää Postin
[Pickup Point API:lla](https://developer.posti.com/) (versio `2025-04`).

- OAuth-tunnus haetaan kerran ja pidetään välimuistissa, kunnes sen voimassaoloa on jäljellä 30 s. Samanaikaiset haut
  käyttävät yhteistä tunnuspyyntöä.
- Jos tunnus hylätään HTTP 401 -virheellä, tilalle haetaan uusi ja haku yritetään kerran uudelleen.
- Tulokset muunnetaan yhtenäiseen, tyypitettyyn muotoon. Alkuperäinen objekti säilyy kentässä `raw`.
- Ei riippuvuuksia. Node.js 18.17 tai uudempi (globaali `fetch`).

Paketti ei ole Postin tekemä eikä Postin kanssa yhteistyössä tehty. Tarvitset omat rajapintatunnukset Postilta
(tilataan Postin LogEDI-yhteyshenkilön kautta).

Mukana olevan esimerkin tuloste oikeilla tunnuksilla (testattu Postin tuotantorajapintaa vasten 10.11.2026):

```text
$ node --env-file=.env examples/search.js 00100
5 points near 00100:
- Postin automaatti, Lidl Graniittitalo (locker), Salomonkatu 13, 00104 Helsinki, 319 m
- Posti, K-Market Etu-Töölö (pickup), Lapuankatu 4, 00100 Helsinki, 322 m
- Posti, K-Market BiiliTalo (pickup), Salomonkatu 17, 00100 Helsinki, 351 m
- Postin automaatti, K-Market BiiliTalo (locker), Salomonkatu 17, 00104 Helsinki, 351 m
- Postin automaatti, Lidl Sähkötalo (locker), Kampinkuja 2, 00104 Helsinki, 410 m
```

## Asennus

```sh
npm install @niemenjoki/posti-pickup-points
```

## Käyttö

Aja koodi vain palvelimella. Älä koskaan lähetä client secretiä selaimeen.

```js
import { createPostiPickupClient, PostiPickupError } from '@niemenjoki/posti-pickup-points';

const posti = createPostiPickupClient({
  clientId: process.env.POSTI_CLIENT_ID,
  clientSecret: process.env.POSTI_CLIENT_SECRET,
});

try {
  const points = await posti.search({ postalCode: '00100', limit: 5 });
  for (const p of points) console.log(p.name, p.street, p.distanceInMeters);
} catch (error) {
  if (error instanceof PostiPickupError) console.error(error.code, error.status);
  else throw error;
}
```

Luo asiakas kerran ja käytä sitä uudelleen, jotta tunnuksen välimuisti toimii.

### Haun asetukset

| Asetus | Oletus | Huomiot |
|---|---|---|
| `postalCode` | pakollinen | Välilyönnit poistetaan. Maalle `FI` postinumeron on oltava viisi numeroa. |
| `street`, `city` | - | Valinnainen. Tarkentaa hakupaikkaa. |
| `countryCode` | `FI` | Postinumeron muoto tarkistetaan vain maalle `FI`. |
| `limit` | `8` | Positiivinen kokonaisluku, palautettavien tulosten enimmäismäärä. Kun `type` tai `excludeAland` on käytössä, Postilta pyydetään enintään kolminkertainen määrä pisteitä (korkeintaan 50), jotta suodatettu lista on yleensä täysi. Postilla voi olla oma enimmäismääränsä. |
| `type` | `all` | `parcelLocker` tai `pickupPoint`. Suodatus tehdään tuloksen `parcelLocker`-tiedon perusteella. |
| `excludeAland` | `false` | Hylkää ahvenanmaalaisen postinumeron (22xxx) ja poistaa Ahvenanmaan tulokset, esim. kun toimitukset Ahvenanmaalle vaativat tullauksen. |
| `serviceFilters` | `{}` | Välitetään Postille sellaisenaan, esim. `{ outdoorLocker: false }`. Suodattimien nimet ovat Postin rajapinnan dokumentaatiossa. |
| `language` | - | Lähetetään `Accept-Language`-otsakkeena (`fi`, `sv`, `en`). |

### Tulos

```ts
{
  id: string; name: string; careOf: string;
  street: string; postalCode: string; city: string; municipality: string; countryCode: string;
  specificLocation: string; parcelLocker: boolean; routingServiceCode: string;
  distanceInMeters: number | null; raw: unknown;
}
```

Puuttuvat tekstikentät ovat tyhjiä merkkijonoja. `distanceInMeters` on `null`, kun Posti ei palauta kelvollista
lukua.

### Asiakkaan asetukset

`authUrl`, `gatewayUrl` ja `apiVersion` korvaavat oletukset (`https://gateway-auth.posti.fi/api/v1/token`,
`https://gateway.posti.fi`, `2025-04`). `timeoutMs` (oletus 10000) koskee jokaista pyyntöä. `fetch` ja `now`
voidaan korvata esimerkiksi testeissä.

### Virheet

Jokainen virhe on `PostiPickupError`, jolla on `code`:

| Koodi | Milloin |
|---|---|
| `missing_credentials`, `missing_fetch` | Asiakasta luotaessa |
| `invalid_postcode`, `invalid_limit`, `invalid_type` | Virheellinen syöte. Postille ei lähetetä mitään. |
| `auth_failed` | Tunnuspyyntö epäonnistui tai ei palauttanut tunnusta |
| `upstream_error` | Haku palautti muun kuin 2xx-tilan (`status` ja `details` asetetaan) |
| `invalid_response` | Hakuvastauksessa ei ollut `pickupPoints`-taulukkoa |
| `timeout`, `network_error` | Ei vastausta |

## Testit

```sh
npm test
```

Testit käyttävät korvattua `fetch`-funktiota ja keksittyjä vastauksia kansiossa `test/fixtures` (kuvitteellisia
paikkoja). Ne eivät kutsu Postia.

Oikean rajapinnan voi kokeilla omilla tunnuksilla: kirjoita `POSTI_CLIENT_ID` ja `POSTI_CLIENT_SECRET` tiedostoon
`.env` ja aja `node --env-file=.env examples/search.js 00100` (suodatus: lisää `parcelLocker` tai `pickupPoint`).

## Muutokset

Ks. [CHANGELOG.md](CHANGELOG.md) (englanniksi).

## Lisenssi

MIT
