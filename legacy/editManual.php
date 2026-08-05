<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("Manual.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$errors = array();
$required_fields = array('editManual_description');

if(isset($_POST['manualId'])){
	$manualId = $_POST['manualId'];     
	$manual = Manual::find_by_id($manualId);
	$allManuals = Manual::find_all();
?>

<!-- Load existing values for examination and get the original value for edit validation-->
<script>
	var currentManualDescription = '<?=$manual->description?>';
	var existingManual = Array();
<?php 
	foreach($allManuals as $aManual){
?>
	existingManual.push('<?=$aManual->description?>');
<?php
	}
?>
</script>
<script src='validator.js'></script>
	<div id="registerErrorMessages"></div>
	<form action="editManual.php" method="post" id="editManualForm">
		<legend class="formTitle">Edit Manual:</legend>
		<input type="hidden" id="submit2" name="submit"/>
		<input type="hidden" id="id" name="id" value="<?=$manual->id?>"/> </br>
		<label for="editManual_description">Description:</label>
		<input class="text" id="editManual_description" name="editManual_description" value="<?=$manual->description?>"/> </br>
		<div style="color:red; font-size:12px;" class="validation"></div></br>
		<div class="span12">
			<div class="row-fluid">
				<div class='span6'>
					<input id="editManualSubmit" type="submit" name="submit" class="btn btn-primary"/>
					<script>

					$('#editManualForm input').blur(function(){
						var id = $(this).attr('id');
						var description = $(this).val();
						switch(id){
							case 'editManual_description' :
								if(description.length == 0){
									$(this).siblings('div[class="validation"]').text('A description is required.');
								} else if ((jQuery.inArray(description, existingManuals) >= 0) && (currentManualDescription != existingManuals[jQuery.inArray(description, existingManuals)])) {
									$(this).siblings('div[class="validation"]').text('This manual already exists.');
								} else {
									$(this).siblings('div[class="validation"]').text('');	
								}
								break;
							default: 
								break;
						}
					});

						$('#editManualSubmit').click(function(e){

							e.preventDefault();
							e.stopPropagation();
							validatorInstance.collectManualDataForEditing(existingManual,currentManualDescription);
						});
					</script>
				</div>
				<div class='span6'>
					<button id="cancelManualSubmit" class='btn btn-primary' type='button'>Cancel</button>
					<script>
						$('#cancelManualSubmit').click(function(e){
							$("#addEditManualBlock").load('uploadManual.php');
						});
					</script>
				</div>
			</div>
		</div>
	</form>	
<?php
} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$description = mysql_real_escape_string(htmlspecialchars($_POST['editManual_description']));


		$newManual = Manual::newManual($description);
		$newManual->id = $id;
		if($newManual->save()){
			// redirect_to("manualListing.php");
		} else {
			die("Cannot register manual. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>