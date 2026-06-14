const puppeteer = require('puppeteer')
const random_useragent = require('random-useragent')

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

  const dt = await frame.evaluate(() =>
    [...document.querySelectorAll('table')][2].innerText.split('\n')
  )

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

  // console.log(dt) guardar todos los datos de la causa

  const tlit = async params => {
    params.click !== null ? await frame.click(params.click) : ''
    await frame.waitForSelector(params.waitForSelector)
    await frame.waitForTimeout(params.waitForTimeout)

    return await frame.evaluate(({ book, waitForSelector }) => {
      const a = [
        ...document.querySelectorAll(`${waitForSelector} table`)
      ][1].innerText.split('\n')
      let arr = []
      // a.forEach((e, ind) => {
      //   arr.push(e.split('\t'))
      //   if (waitForSelector === '#Historia') {
      //     arr[ind].push(book)
      //   }
      // })
      for (let [ind, e] of a.entries()) {
        arr.push(e.split('\t'))
        if (waitForSelector === '#Historia') {
          arr[ind].push(book)
        }
      }
      return arr
    }, params)
  }

  let rtht = []
  let resArr, rtlit

  // for (let [e, idx] of bks.entries()) {
  bks.forEach(async (e, idx) => {
    if (idx !== 0) {
      await frame.select('table#TablaCuadernos select.comboBox', `${e.value}`)
      // console.log('asd select')
      // console.log(asd)

      // const btn = await frame.$('table#TablaCuadernos a#botoncuaderno')
      //  document
      //   .querySelector('table#TablaCuadernos')
      //   .querySelectorAll('td')[1]
      //   .querySelector('a')
      //   .click()

      // btn.click()

      let [r1, r2, r3] = await Promise.all([
        await frame.waitForTimeout(3000),
        await frame.click(
          // 'table#TablaCuadernos a[onclick="AtPublicoPpalForm.irAccionAtPublico.click();"]'
          'table#TablaCuadernos a#botoncuaderno'
        ),
        await tlit({
          click: null,
          book: e.text,
          waitForSelector: '#Historia',
          waitForTimeout: 1500
        })
      ])
      resArr = r3
    } else {
      resArr = await tlit({
        click: null,
        book: e.text,
        waitForSelector: '#Historia',
        waitForTimeout: 1500
      })
    }

    console.log('resArr')
    console.log(resArr)
    console.log('idx')
    console.log(idx)

    rtht = [...rtht, ...resArr]
  })

  setTimeout(async () => {
    rtlit = await tlit({
      click: 'td#tdDos',
      book: 0,
      waitForSelector: '#Litigantes',
      waitForTimeout: 1500
    })

    console.log('----DT----')
    console.log(dt)
    console.log('----BE----')
    console.log(botonEnlace)
    console.log('----bks----')
    console.log(bks)
    console.log('----tht----')
    console.log(rtht)
    console.log('-----tlit----')
    console.log(rtlit)
  }, 5000)

  return {
    dt,
    botonEnlace,
    rtht,
    rtlit
  }
}

// export default ss = async () => {
const ss = async () => {
  const browser = await puppeteer.launch({ headless: true }) //estaba false
  const page = await browser.newPage()
  await page.goto('https://oficinajudicialvirtual.pjud.cl/', {
    // wait completed load
    waitUntil: 'load',
    // Remove the timeout
    timeout: 0
  })
  await page.setViewport({ width: 1200, height: 800 })
  // await page.setUserAgent(
  //   random_useragent.getRandom(function (ua) {
  //     return (
  //       (ua.browserName === 'Chrome' || 'Firefox') &&
  //       parseFloat(ua.browserVersion) >= 40
  //     )
  //   })
  // )
  // handle frame
  await page.waitForSelector('frame')

  const frames = await page.frames()
  const frame = frames.find(f => f.name().includes('body'))
  // filling form in iframe

  await td(
    {
      rol: '92',
      era: '2022',
      court: '259'
    },
    frame
  )

  // const logger = fs.createWriteStream('pru.txt', { flags: 'a' })
  // logger.write(`${dt}`)
  // logger.close()

  await page.waitForTimeout(30000)
  // await page.screenshot({ path: 'example.png' })

  // await browser.close()
}

ss()
