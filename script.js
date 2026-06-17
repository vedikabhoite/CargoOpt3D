function calculate(){

    let cLength = Number(document.getElementById("cLength").value);
    let cWidth = Number(document.getElementById("cWidth").value);
    let cHeight = Number(document.getElementById("cHeight").value);

    let boxLength = Number(document.getElementById("boxLength").value);
    let boxWidth = Number(document.getElementById("boxWidth").value);
    let boxHeight = Number(document.getElementById("boxHeight").value);

    let quantity = Number(document.getElementById("quantity").value);

    let containerVolume =
        cLength * cWidth * cHeight;

    let cartonVolume =
        boxLength * boxWidth * boxHeight;

    let totalCartonVolume =
        cartonVolume * quantity;

    let utilization =
        (totalCartonVolume / containerVolume) * 100;

    document.getElementById("result").innerHTML = `
        <h3>Results</h3>

        Container Volume:
        ${containerVolume}<br><br>

        Total Carton Volume:
        ${totalCartonVolume}<br><br>

        Utilization:
        ${utilization.toFixed(2)}%
    `;
}