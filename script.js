let cartons = [];

// --------------------
// Add Carton
// --------------------
function addCarton() {

    let length =
        Number(document.getElementById("boxLength").value);

    let width =
        Number(document.getElementById("boxWidth").value);

    let height =
        Number(document.getElementById("boxHeight").value);

    let quantity =
        Number(document.getElementById("quantity").value);

    let volume =
        length * width * height;

    cartons.push({
        length,
        width,
        height,
        quantity,
        volume
    });

    displayCartons();
}

// --------------------
// Display Table
// --------------------
function displayCartons() {

    let tbody =
        document.querySelector("#cartonTable tbody");

    tbody.innerHTML = "";

    cartons.forEach(carton => {

        tbody.innerHTML += `
        <tr>
            <td>${carton.length}</td>
            <td>${carton.width}</td>
            <td>${carton.height}</td>
            <td>${carton.quantity}</td>
            <td>${carton.volume}</td>
        </tr>
        `;
    });
}

// --------------------
// Calculate
// --------------------
function calculate() {

    let cLength =
        Number(document.getElementById("cLength").value);

    let cWidth =
        Number(document.getElementById("cWidth").value);

    let cHeight =
        Number(document.getElementById("cHeight").value);

    let containerVolume =
        cLength * cWidth * cHeight;

    let usedVolume = 0;

    let loaded = [];
    let rejected = [];

    cartons.sort(
        (a, b) => b.volume - a.volume
    );

    cartons.forEach(carton => {

        let totalVolume =
            carton.volume * carton.quantity;

        if (
            usedVolume + totalVolume
            <= containerVolume
        ) {

            loaded.push(carton);
            usedVolume += totalVolume;

        } else {

            rejected.push(carton);
        }
    });

    let utilization =
        (usedVolume / containerVolume) * 100;

    document.getElementById("result").innerHTML = `

        <h2>Optimization Results</h2>

        Container Volume:
        ${containerVolume}

        <br><br>

        Used Volume:
        ${usedVolume}

        <br><br>

        Free Space:
        ${containerVolume - usedVolume}

        <br><br>

        Utilization:
        ${utilization.toFixed(2)}%

        <br><br>

        <h3>Loaded Cartons</h3>

        ${loaded.map(carton => `
            ${carton.length} ×
            ${carton.width} ×
            ${carton.height}
            Qty: ${carton.quantity}
            <br>
        `).join("")}

        <h3>Rejected Cartons</h3>

        ${rejected.map(carton => `
            ${carton.length} x
            ${carton.width} x
            ${carton.height}
            Qty: ${carton.quantity}
            <br>
        `).join("")}
    `;
}
