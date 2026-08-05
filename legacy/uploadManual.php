<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("function.php");
require_once("Manual.php");
require_once("Session.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

if(isset($_POST['submit'])){

	$description = mysql_real_escape_string(htmlspecialchars($_POST['uploadManual_description']));
	$theNewManual = Manual::newManual($description);

	if($theNewManual->save()){
		return true;
	} else {
		die("The manual could not be added. " . mysql_error());
	}
}	

$manuals = Manual::find_all();
?>

<!-- Load existing values for examination -->
<script>
	var existingManuals = Array();
<?php 
	foreach($manuals as $manual){
?>
	existingManuals.push('<?=$manual->description?>');
<?php
	}
?>
</script>
<script src='validator.js'></script>

<div id="manualAdd">
	<form id="manualAddForm" action="uploadManual.php" method="post">
		<legend class="formTitle">New Manual:</legend>
		<fieldset>
			<label for="uploadManual_description">Description:</label>
			<input class="text" name="uploadManual_description" id="uploadManual_description"/></br>
			<div style="color:red; font-size:12px;" class="validation"></div>
			<input id="submit" type="hidden" name="submit"/></br>
			<input id="manualAddSubmit" type="submit" name="submit" class="btn btn-primary pull-right"/></br>
		</fieldset>
	</form>
</div>

<script>

	$('#manualAddForm input').blur(function(){
		var id = $(this).attr('id');
		var value = $(this).val();
		switch(id){
			case 'uploadManual_description' :
				if(value.length == 0){
					$(this).siblings('div[class="validation"]').text('A description is required.');
				} else if (jQuery.inArray(value, existingManuals) >= 0) {
					$(this).siblings('div[class="validation"]').text('This manual already exists.');
				} else {
					$(this).siblings('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});
	$('#addEditManualBlock').unbind();
	$('#addEditManualBlock').on('click', '#manualAddSubmit', function(e){
		e.preventDefault();
		e.stopPropagation();
		validatorInstance.collectManualData(existingManuals);
	});
</script>