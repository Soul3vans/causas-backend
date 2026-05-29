// const random_useragent = require('random-useragent')
// const puppeteer = require('puppeteer')
const { luxonDateTime } = require('./dateTime')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())
const { courtIdByName } = require('./seedsjudge')

const td = async (options, frame) => {
  await frame.waitForSelector('#tribUno>select.comboBox')
  await frame.type('input[name="ROL_Causa"]', options.rol)
  await frame.type('input[name="ERA_Causa"]', options.era)
  await frame.select('#tribUno>select.comboBox', options.court)
  await frame.click('a[onclick="AtPublicoPpalForm.irAccionAtPublico.click();"]')
  await frame.waitForSelector('.textoC')
  const boton = await frame.$('table#contentCellsAddTabla tbody tr td.textoC a')
  const botonEnlace = await frame.evaluate(
    () =>
      document.querySelector('table#contentCellsAddTabla tbody tr td.textoC a')
        .href
  )
  await boton.click()

  await frame.waitForSelector('#divAnexoCau')

  const dt = await frame.evaluate(() => {
    const a = [...document.querySelectorAll('table')][2].innerText.split('\n')
    let c = []
    // a.forEach(e => {
    for (const e of a) {
      c.push(e.split('\t'))
    } //)
    let crr = {}
    ;(crr['rol'] = c[0][0].split(':')[1]),
      (crr['cover'] = c[0][1]),
      (crr['admission'] = c[0][2].split(':')[1]),
      (crr['estAdmin'] = c[1][0].split(':')[1]),
      (crr['process'] = c[1][1].split(':')[1]),
      (crr['location'] = c[1][2].split(':')[1]),
      (crr['stage'] = c[2][0].split(':')[1]),
      (crr['processState'] = c[2][1].split(':')[1]),
      (crr['court'] = c[3][0].split(':')[1]),
      (crr['processState'] = c[2][1].split(':')[1]),
      (crr['status'] = crr['stage'].split(' ')[0] !== 8 ? 'ACTIVE' : 'CLOSED')
    return crr
  })

  console.log('dt.admission')
  const g = dt.admission.split('/')
  const parseDate = new Date(`${g[1]}/${g[0]}/${g[2]}`)
  dt.admission = parseDate

  /**
   * get all cases books
   * and return
   * title and value
   */

  const bks = await frame.evaluate(() => {
    const bks = document
      .querySelector('table#TablaCuadernos select.comboBox')
      .querySelectorAll('option')
    const arrBks = []
    // bks.forEach(e => {
    //   arrBks.push({
    //     text: e.innerText,
    //     value: e.value
    //   })
    // })
    for (const e of bks) {
      arrBks.push({
        text: e.innerText,
        value: e.value
      })
    }
    return arrBks
  })

  console.log('bks')
  console.log(bks)

  // console.log(dt) guardar todos los datos de la causa

  console.log('tlit')
  const tlit = async params => {
    // const previousData = await frame.evaluate(params => {
    //   ;[...document.querySelectorAll(`${params.waitForSelector} table`)][1]
    //     .innerText
    // }, params)

    // const dtsd = {
    //   pd: previousData,
    //   pa: params
    // }

    params.click !== null ? await frame.click(params.click) : ''
    await frame.waitForSelector(params.waitForSelector)
    await frame.waitForTimeout(params.waitForTimeout)
    // await frame.waitForFunction(
    //   data => {
    //     return (
    //       data.pd !==
    //       [...document.querySelectorAll(`${data.pa.waitForSelector} table`)][1]
    //         .innerText
    //     )
    //   },
    //   {},
    //   dtsd
    // )

    // if (params.click !== null) {
    //   await Promise.all([
    //     await frame.click(params.click),
    //     await frame.waitForSelector(params.waitForSelector),
    //     await frame.waitForTimeout(params.waitForTimeout)
    //   ])
    // } else {
    //   await frame.waitForSelector(params.waitForSelector)
    //   await frame.waitForTimeout(params.waitForTimeout)
    // }

    return await frame.evaluate(({ book, waitForSelector }) => {
      let arr = []
      console.log('Table InnerText')
      console.log(
        [...document.querySelectorAll(`${waitForSelector} table`)][1].innerText
      )
      if (
        [...document.querySelectorAll(`${waitForSelector} table`)][1]
          .innerText !== ''
      ) {
        const a = [
          ...document.querySelectorAll(`${waitForSelector} table`)
        ][1].innerText.split('\n')

        const b = [
          ...[...document.querySelectorAll('#Historia table')][1]
            .querySelector('tr tbody')
            .querySelectorAll('tr')
        ]

        a.forEach((v, i) => {
          // for (const [i, v] of a.entries()) {
          if (a.length > 0) {
            arr.push(v.split('\t'))
            if (waitForSelector === '#Historia') {
              arr[i].push(book)
              let tdind = b[i].querySelectorAll('td')
              if (tdind[1].querySelector('img')) {
                arr[i][1] = `https://civil.pjud.cl/CIVILPORWEB/${
                  tdind[1]
                    .querySelector('img')
                    .getAttribute('onClick')
                    .split('/')[2]
                    .split("'")[0]
                }`
              } else {
                arr[i][1] = 'SD'
              }
            }
          }
        })
      }
      return arr
    }, params)
  }

  let rtht = []
  let resArr, rtlit
  let timer = 0

  // bks.forEach(async (e, idx) => {
  //   console.log('idx ' + idx)
  //   if (idx > 0) {
  //     const ase = await frame.select(
  //       'table#TablaCuadernos select.comboBox',
  //       `${e.value}`
  //     )

  //     console.log('bks loop')
  //     console.log('ase ' + ase)
  //     const resArrRaw = () => {
  //       return new Promise((resolve, reject) => {
  //         setTimeout(async () => {
  //           console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
  //           let [r1, r2, r3] = await Promise.all([
  //             // let [r2, r3] = await Promise.all([
  //             await frame.click(
  //               // 'table#TablaCuadernos a[onclick="AtPublicoPpalForm.irAccionAtPublico.click();"]'
  //               'table#TablaCuadernos a#botoncuaderno'
  //             ),
  //             await frame.waitForTimeout(2500),
  //             await tlit({
  //               click: null,
  //               book: e.text,
  //               waitForSelector: '#Historia',
  //               waitForTimeout: 3500
  //             })
  //           ])
  //           resolve(r3)
  //           console.log('timer:', timer)
  //         }, timer)
  //       })
  //     }
  //     resArr = await resArrRaw()
  //   } else {
  //     console.log('resArr en else')
  //     resArr = await tlit({
  //       click: null,
  //       book: e.text,
  //       waitForSelector: '#Historia',
  //       waitForTimeout: 3500
  //     })
  //   }

  //   rtht = [...rtht, ...resArr]
  //   timer += 3500
  //   // console.log('rtht')
  //   // console.log(rtht)
  // })

  const comBoSelect = async (e, idx) => {
    console.log('idx ' + idx)
    if (idx > 0) {
      const ase = await frame.select(
        'table#TablaCuadernos select.comboBox',
        `${e.value}`
      )

      console.log('bks loop')
      console.log('ase ' + ase)
      // const resArrRaw = () => {
      //   return new Promise((resolve, reject) => {
      //     setTimeout(async () => {
      //       console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      let [r1, r2, r3] = await Promise.all([
        // let [r2, r3] = await Promise.all([
        await frame.click(
          // 'table#TablaCuadernos a[onclick="AtPublicoPpalForm.irAccionAtPublico.click();"]'
          'table#TablaCuadernos a#botoncuaderno'
        ),
        await frame.waitForTimeout(2500),
        await tlit({
          click: null,
          book: e.text,
          waitForSelector: '#Historia',
          waitForTimeout: 3500
        })
      ])
      //       resolve(r3)
      //       console.log('timer:', timer)
      //     }, timer)
      //   })
      // }
      // resArr = await resArrRaw()
      resArr = await r3
    } else {
      console.log('resArr en else')
      resArr = await tlit({
        click: null,
        book: e.text,
        waitForSelector: '#Historia',
        waitForTimeout: 3500
      })
    }

    rtht = [...rtht, ...resArr]
    // timer += 3500
    // console.log('resArr')
    // console.log(resArr)
  }

  for (const [i, v] of bks.entries()) {
    // console.log('v:', v)
    setTimeout(async () => {
      await comBoSelect(v, i)
    }, timer)
    timer += 3500
  }

  // })()

  // const rtht = await tlit({
  //   click: null,
  //   book: 0,
  //   waitForSelector: '#Historia',
  //   waitForTimeout: 7500
  // })

  setTimeout(async () => {
    rtlit = await tlit({
      click: 'td#tdDos',
      book: 0,
      waitForSelector: '#Litigantes',
      waitForTimeout: 1500
    })

    const artht = []
    const brtlit = []

    // rtht.forEach(e => {
    for (const e of rtht) {
      // console.log('e[6]', e[6])
      // j = e[6].trim().split('/')
      j = e[6].split('/')
      artht.push({
        invoice: e[0],
        document: e[1],
        annex: e[2],
        stage: e[3],
        procedure: e[4],
        descProcedure: e[5],
        dateProcedure: new Date(`${j[1]}/${j[0]}/${j[2]}`),
        page: e[7],
        book: e[8]
      })
    } //)

    // rtlit.forEach(e => {
    for (const e of rtlit) {
      if (e[0] === 'DDOR.' || e[0] === 'DDO.') {
        dt['debtor'] = e[3]
      }
      brtlit.push({
        participant: e[0],
        rut: e[1],
        person: e[2],
        name: e[3]
      })
    } //)

    dt['movementsHistory'] = artht
    dt['litigants'] = brtlit
    dt['extLink'] = botonEnlace
  }, 14000)

  return dt
}

const scrapRawData = async scrapOptions => {
  const browser = await puppeteer.launch({
    headless: false
    // args: [
    //   '--no-sandbox'
    //   // `--proxy-server=${proxy1.host}:${proxy1.port}`
    // ]
  })
  try {
    // const [proxy1] = await getFreeProxies()
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })
    // await page.setUserAgent(
    //   random_useragent.getRandom(function (ua) {
    //     return (
    //       (ua.browserName === 'Chrome' || 'Firefox') &&
    //       parseFloat(ua.browserVersion) >= 40
    //     )
    //   })
    // )
    await page.goto('https://civil.pjud.cl/CIVILPORWEB/', {
      // wait completed load
      waitUntil: 'load',
      // Remove the timeout
      timeout: 0
    })
    // handle frame
    await page.waitForSelector('frame')

    const frames = await page.frames()
    const frame = frames.find(f => f.name().includes('body'))
    // filling form in iframe

    // console.table({ input })

    const ltd = await td(
      {
        rol: scrapOptions.rol.split('-')[1],
        era: scrapOptions.rol.split('-')[2],
        court: courtIdByName(scrapOptions.court).toString()
      },
      frame
    )

    await page.waitForTimeout(20000)
    // await page.screenshot({ path: 'example.png' })
    await browser.close()
    return ltd
  } catch (error) {
    console.log(error)
  } finally {
    await browser.close()
  }
}

module.exports = {
  td,
  scrapRawData
}
